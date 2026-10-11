// 到一台电脑的连接（docs/mobile-remote.md §13.3）：连云端中转 → （没配对完时）发配对请求 → Noise 握手 → 加密通道 + RPC。
// 网页版和中转同源：中转地址取当前页面的地址（线上是云端服务的 /m/，本机开发由 Vite 转给本机云端）。
import {
  FrameType,
  Initiator,
  PROLOGUE,
  RpcCore,
  SecureChannel,
  bridgeProtocols,
  decodeFrame,
  decodeJson,
  encodeFrame,
  encodeJson,
  fromBase64Url,
  keypairFrom,
  type HandshakeResult,
} from '@pixelsky/link'
import { inApp } from '@/platform'
import { browserCodec } from './codec'
import type { Pairing } from './storage'

export type LinkState =
  /** 正在连中转 */
  | 'connecting'
  /** 中转连上了，电脑不在线（关机、睡眠、没开手机连接） */
  | 'desktop_offline'
  /** 扫码后等电脑上确认 */
  | 'waiting_confirm'
  | 'handshaking'
  | 'ready'
  /** 被电脑移除，或令牌作废：不再重连，要重新扫码 */
  | 'removed'
  /** 连不上中转（没网），稍后自动重试 */
  | 'offline'

export interface Hello {
  version: number
  name: string
  access: 'view' | 'act'
}

export interface LinkHooks {
  onState(state: LinkState): void
  /** 电脑推来的事件（engine:event 的内容） */
  onEvent(event: unknown): void
  /** 配对状态变了（确认 / 移除），要存下来 */
  onPairing(pairing: Pairing): void
}

/** 中转关闭码（services/cloud/internal/bridge）：令牌失效 */
const CLOSE_UNAUTHORIZED = 4001

/** 网页版：和页面同源；App 里：配对时二维码给的中转地址 */
export function relayUrl(pairing: Pairing): string {
  if (inApp && pairing.relay) {
    const url = new URL(pairing.relay)
    url.searchParams.set('role', 'phone')
    return url.toString()
  }
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/v1/bridge/ws?role=phone'
}

export class DesktopLink {
  state: LinkState = 'connecting'
  hello: Hello | null = null
  private ws: WebSocket | null = null
  private rpc: RpcCore | null = null
  private channel: SecureChannel | null = null
  private initiator: Initiator | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private delay = 1000
  private stopped = true

  constructor(
    public pairing: Pairing,
    private readonly hooks: LinkHooks,
  ) {}

  start(): void {
    if (!this.stopped || this.pairing.status === 'removed') return
    this.stopped = false
    this.open()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.reset()
    this.ws?.close()
    this.ws = null
  }

  /** 页面回到前台：连接可能早被系统断了，没连着就马上重连，连着就探一下 */
  wake(): void {
    if (this.stopped) return
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      if (this.timer) clearTimeout(this.timer)
      this.delay = 1000
      this.open()
    } else if (this.state === 'ready') this.call('hello').catch(() => this.ws?.close())
  }

  call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    if (!this.rpc || this.state !== 'ready') return Promise.reject(new Error('MOBILE_NOT_READY'))
    return this.rpc.call<T>(method, args, 20_000)
  }

  private set(state: LinkState): void {
    if (this.state === state) return
    this.state = state
    this.hooks.onState(state)
  }

  private reset(): void {
    this.rpc?.close()
    this.rpc = null
    this.channel = null
    this.initiator = null
    this.hello = null
  }

  private open(): void {
    this.reset()
    this.set('connecting')
    const ws = new WebSocket(relayUrl(this.pairing), bridgeProtocols(this.pairing.token))
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => (this.delay = 1000)
    ws.onmessage = e => {
      if (this.ws !== ws) return
      if (typeof e.data === 'string') this.onNotice(e.data)
      else this.onFrame(new Uint8Array(e.data as ArrayBuffer))
    }
    ws.onclose = e => {
      if (this.ws !== ws) return
      this.ws = null
      this.reset()
      if (e.code === CLOSE_UNAUTHORIZED) return this.removed()
      if (this.stopped) return
      this.set('offline')
      this.timer = setTimeout(() => this.open(), this.delay * (0.8 + Math.random() * 0.4))
      this.delay = Math.min(30_000, this.delay * 2)
    }
  }

  private removed(): void {
    this.stopped = true
    this.reset()
    this.ws?.close()
    this.pairing = { ...this.pairing, status: 'removed' }
    this.hooks.onPairing(this.pairing)
    this.set('removed')
  }

  private send(type: (typeof FrameType)[keyof typeof FrameType], body: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeFrame(type, body) as Uint8Array<ArrayBuffer>)
  }

  private onNotice(text: string): void {
    let type = ''
    try {
      type = JSON.parse(text).type
    } catch {}
    if (type === 'desktop_offline') {
      this.reset()
      this.set('desktop_offline')
    } else if (type === 'desktop_online') {
      // 电脑（重新）上线：它那边的加密会话没了，重新握手；还没确认的再发一次配对请求
      if (this.pairing.status === 'pending') this.sendPair()
      else this.handshake()
    }
  }

  private sendPair(): void {
    if (!this.pairing.request) return
    this.send(FrameType.Pair, encodeJson(this.pairing.request))
    this.set('waiting_confirm')
  }

  private handshake(): void {
    this.reset()
    this.initiator = new Initiator({
      local: keypairFrom(fromBase64Url(this.pairing.phoneKey)),
      remote: fromBase64Url(this.pairing.desktopKey),
      prologue: PROLOGUE,
    })
    this.send(FrameType.Handshake1, this.initiator.writeMessage1())
    this.set('handshaking')
  }

  private onFrame(frame: Uint8Array): void {
    let f: ReturnType<typeof decodeFrame>
    try {
      f = decodeFrame(frame)
    } catch {
      return
    }
    if (f.type === FrameType.PairResult) {
      const status = (decodeJson(f.body) as { status?: string }).status
      if (status === 'pending') this.set('waiting_confirm')
      else if (status === 'rejected') this.removed()
      else if (status === 'accepted' && this.pairing.status === 'pending') {
        this.pairing = { ...this.pairing, status: 'paired', request: undefined }
        this.hooks.onPairing(this.pairing)
        this.handshake()
      }
    } else if (f.type === FrameType.Handshake2 && this.initiator) {
      try {
        this.finish(this.initiator.readMessage2(f.body).result)
      } catch {
        this.ws?.close()
      }
    } else if (f.type === FrameType.Data) this.channel?.receive(f.body)
  }

  private finish(keys: HandshakeResult): void {
    this.initiator = null
    const ws = this.ws
    const rpc = new RpcCore(m => void channel.send(m).catch(() => {}))
    const channel = new SecureChannel(
      keys,
      f => ws?.readyState === WebSocket.OPEN && ws.send(f as Uint8Array<ArrayBuffer>),
      v => rpc.receive(v),
      // 解不开：这条加密会话作废，重新握手
      () => this.handshake(),
      browserCodec,
    )
    rpc.onEvent = (_channel, data) => this.hooks.onEvent(data)
    this.rpc = rpc
    this.channel = channel
    void rpc.call<Hello>('hello', [], 10_000).then(
      hello => {
        if (this.rpc !== rpc) return
        this.hello = hello
        this.set('ready')
      },
      () => this.ws?.close(),
    )
  }
}
