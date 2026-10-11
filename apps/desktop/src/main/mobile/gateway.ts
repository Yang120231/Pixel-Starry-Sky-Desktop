// 手机网关（docs/mobile-remote.md §4、§5）：处理中转转来的帧。不依赖 electron，测试见 gateway.test.ts。
// - 配对：核对二维码密钥算的校验码 → 等用户在电脑上确认 → 记下手机公钥；
// - 握手：只和已配对的手机做 Noise KK，之后一部手机一条加密通道 + 一个 RpcCore；
// - 调用：只放行契约里标了 mobile 的通道，「只看」的手机不能调 act 的；参数先清洗（不能放宽权限、改线路）；
// - 事件：和窗口看到的同一份；会话事件只推给打开着这个会话的手机，会话列表合并节流。
import { IPC_CONTRACT, type HostEvent, type IpcChannelSpec, type SessionSummary } from '@pixelsky/protocol'
import {
  FrameType,
  LINK_VERSION,
  PROLOGUE,
  Responder,
  RpcCore,
  SecureChannel,
  decodeFrame,
  decodeJson,
  encodeFrame,
  encodeJson,
  encodeOffer,
  fingerprint,
  fromBase64Url,
  newPairingSecret,
  toBase64Url,
  verifyPairRequest,
  type Codec,
  type PairStatus,
} from '@pixelsky/link'
import type { EngineCall } from '../app/context'
import { slimForPhone } from '../core/engine/tail'
import type { MobilePairing } from '../../shared/types/mobile'
import type { MobileStore } from './store'

const contract: Readonly<Record<string, IpcChannelSpec>> = IPC_CONTRACT

/** 二维码有效期 */
export const PAIRING_TTL = 5 * 60_000
/** 每部手机最多同时盯几个会话的实时事件 */
const MAX_WATCHED = 4
/** 会话列表推送的节流间隔 */
const SESSIONS_THROTTLE = 500
/** 推给手机的会话列表最多几条（去掉归档，按更新时间） */
const MAX_SESSIONS = 200

export interface GatewayDeps {
  store: Pick<MobileStore, 'desktopId' | 'device' | 'addDevice' | 'touch' | 'keypair'>
  desktopName(): string
  relay(): string
  /** 手机网页版的地址：二维码做成这个地址的链接，手机相机扫了直接打开；null 时二维码是 pixelsky:// */
  web?(): string | null
  call: EngineCall
  /** 经中转发一帧给手机 */
  send(phone: string, frame: Uint8Array): void
  codec: Codec
  /**
   * 云端的设备管理（M2，services/cloud 的 /v1/bridge/*）：配对码、确认、移除。
   * 为 null 时（单元测试、本机测试中转）不经过云端，二维码里没有配对码。
   */
  cloud: CloudDevices | null
  /** 配对状态、在线状态变了（设置页刷新） */
  changed(): void
  now?(): number
}

export interface CloudDevices {
  pairing(): Promise<{ code: string; expiresAt: number }>
  confirm(phone: string): Promise<void>
  remove(phone: string): Promise<void>
}

interface Peer {
  phone: string
  channel: SecureChannel
  rpc: RpcCore
  watching: string[]
  /** 电脑上已经吊销：回完这一次就断开 */
  revoked?: boolean
}

interface Pairing {
  secret: string
  offer: string
  expires: number
  status: MobilePairing['status']
  request: { phone: string; publicKey: Uint8Array; name: string } | null
}

/** 手机看到的会话列表：不含归档，最近更新的在前，最多 200 条 */
export function phoneSessions(list: readonly SessionSummary[]): SessionSummary[] {
  return list
    .filter(s => !s.record.archivedAt)
    .sort((a, b) => b.record.updatedAt - a.record.updatedAt)
    .slice(0, MAX_SESSIONS)
}

const asString = (v: unknown, max = 200): string => {
  if (typeof v !== 'string' || !v || v.length > max) throw new Error('MOBILE_BAD_ARGUMENT')
  return v
}

/** 手机传来的参数：只留手机该给的字段，其余由电脑上的设置决定（权限模式、线路、模型都用电脑上的） */
export function sanitize(method: string, args: unknown[]): unknown[] {
  switch (method) {
    case 'engine:createSession': {
      const o = (args[0] ?? {}) as Record<string, unknown>
      const engine = o.engine === 'claude' || o.engine === 'codex' ? { engine: o.engine } : {}
      return [{ projectId: asString(o.projectId), ...engine }]
    }
    case 'engine:send': {
      const input = args[1]
      if (typeof input === 'string') return [args[0], asString(input, 100_000)]
      const o = (input ?? {}) as Record<string, unknown>
      return [
        args[0],
        {
          text: typeof o.text === 'string' ? o.text.slice(0, 100_000) : '',
          clientMessageId: asString(o.clientMessageId),
          ...(Array.isArray(o.attachments) ? { attachments: o.attachments.slice(0, 5) } : {}),
        },
      ]
    }
    default:
      return args
  }
}

export class MobileGateway {
  private readonly peers = new Map<string, Peer>()
  private pairing: Pairing | null = null
  private sessionsTimer: ReturnType<typeof setTimeout> | null = null
  private latestSessions: SessionSummary[] | null = null

  constructor(private readonly d: GatewayDeps) {}

  private now(): number {
    return this.d.now?.() ?? Date.now()
  }

  online(phone: string): boolean {
    return this.peers.has(phone)
  }

  // -------------------------------------------------------------------------
  // 配对
  // -------------------------------------------------------------------------

  pairingState(): MobilePairing | null {
    const p = this.pairing
    if (!p) return null
    const status = p.status === 'waiting' && this.now() > p.expires ? 'expired' : p.status
    return {
      offer: p.offer,
      expires: p.expires,
      status,
      request: p.request ? { name: p.request.name, fingerprint: fingerprint(p.request.publicKey) } : null,
    }
  }

  async startPairing(): Promise<MobilePairing> {
    const key = this.d.store.keypair()
    if (!key) throw new Error('MOBILE_NO_CIPHER')
    const relay = this.d.relay()
    if (!relay) throw new Error('MOBILE_BAD_RELAY')
    // 云端的配对码：手机拿它换设备令牌；二维码和配对码同时过期
    const cloud = this.d.cloud ? await this.d.cloud.pairing() : null
    const secret = newPairingSecret(),
      expires = cloud ? Math.min(cloud.expiresAt, this.now() + PAIRING_TTL) : this.now() + PAIRING_TTL
    const offer = encodeOffer(
      {
        v: LINK_VERSION,
        relay,
        desktop: this.d.store.desktopId,
        key: toBase64Url(key.publicKey),
        secret,
        name: this.d.desktopName().slice(0, 64),
        expires,
        ...(cloud ? { code: cloud.code } : {}),
      },
      this.d.web?.() ?? undefined,
    )
    this.pairing = { secret, offer, expires, status: 'waiting', request: null }
    return this.pairingState()!
  }

  cancelPairing(): void {
    const request = this.pairing?.request
    if (request && this.pairing?.status === 'confirm') this.reject(request.phone)
    this.pairing = null
  }

  /** 拒绝一部扫了码的手机：告诉它，并让云端作废它的设备令牌（尽力而为，云端的待确认设备 10 分钟后也会过期） */
  private reject(phone: string): void {
    this.pairResult(phone, 'rejected')
    void this.d.cloud?.remove(phone).catch(() => {})
  }

  /** 用户在电脑上确认或拒绝扫码的手机 */
  async decide(accept: boolean): Promise<void> {
    const p = this.pairing
    if (!p?.request || p.status !== 'confirm') throw new Error('MOBILE_NO_PAIRING')
    const { phone, publicKey, name } = p.request
    if (!accept) {
      p.status = 'rejected'
      this.reject(phone)
      this.d.changed()
      return
    }
    // 先让云端放行（待确认的手机只能发配对请求），再记下来、告诉手机
    await this.d.cloud?.confirm(phone)
    if (this.pairing !== p) return
    {
      this.d.store.addDevice({
        id: phone,
        name,
        publicKey: toBase64Url(publicKey),
        access: 'act',
        pairedAt: this.now(),
      })
      p.status = 'accepted'
    }
    this.pairResult(phone, 'accepted')
    this.d.changed()
  }

  private pairResult(phone: string, status: PairStatus): void {
    try {
      this.d.send(phone, encodeFrame(FrameType.PairResult, encodeJson({ status })))
    } catch {}
  }

  private onPair(phone: string, body: Uint8Array): void {
    const p = this.pairing,
      key = this.d.store.keypair()
    // 没在配对、过期、已经有一部在等确认：不理（不回结果，免得被拿来探测）
    if (!p || !key || p.status !== 'waiting' || this.now() > p.expires) return
    let request: unknown
    try {
      request = decodeJson(body)
    } catch {
      return
    }
    const verified = verifyPairRequest(request, p.secret, key.publicKey)
    if (!verified) return
    p.request = { phone, ...verified }
    p.status = 'confirm'
    this.pairResult(phone, 'pending')
    this.d.changed()
  }

  // -------------------------------------------------------------------------
  // 帧、握手、调用
  // -------------------------------------------------------------------------

  receive(phone: string, frame: Uint8Array): void {
    let decoded: ReturnType<typeof decodeFrame>
    try {
      decoded = decodeFrame(frame)
    } catch {
      return
    }
    if (decoded.type === FrameType.Pair) this.onPair(phone, decoded.body)
    else if (decoded.type === FrameType.Handshake1) this.onHandshake(phone, decoded.body)
    else if (decoded.type === FrameType.Data) this.peers.get(phone)?.channel.receive(decoded.body)
  }

  private onHandshake(phone: string, body: Uint8Array): void {
    const device = this.d.store.device(phone),
      key = this.d.store.keypair()
    if (!device || !key) {
      // 电脑这边没有这部手机（被吊销、电脑重装）：告诉手机重新配对
      this.pairResult(phone, 'rejected')
      return
    }
    let message: Uint8Array, keys
    try {
      const responder = new Responder({ local: key, remote: fromBase64Url(device.publicKey), prologue: PROLOGUE })
      responder.readMessage1(body)
      ;({ message, result: keys } = responder.writeMessage2())
    } catch {
      return
    }
    this.drop(phone)
    let rpc: RpcCore | null = null
    const channel = new SecureChannel(
      keys,
      f => this.d.send(phone, f),
      value => rpc?.receive(value),
      () => this.drop(phone, peer),
      this.d.codec,
    )
    rpc = new RpcCore(
      out => {
        channel.send(out).then(
          // 被吊销的手机：把「已吊销」的回复发出去之后再断开
          () => peer.revoked && this.drop(phone, peer),
          (error: Error) => {
            // 回复太大：告诉手机这次调用失败，而不是让它一直等到超时
            if (error.message === 'LINK_FRAME_TOO_LARGE' && 'result' in out)
              void channel.send({ id: out.id, error: 'MOBILE_TOO_LARGE' }).catch(() => {})
          },
        )
      },
      (method, args) => this.handle(peer, method, args),
    )
    const peer: Peer = { phone, channel, rpc, watching: [] }
    rpc.onClose = () => this.drop(phone, peer)
    this.peers.set(phone, peer)
    try {
      this.d.send(phone, encodeFrame(FrameType.Handshake2, message))
    } catch {
      this.drop(phone, peer)
      return
    }
    this.d.store.touch(phone, this.now())
    this.d.changed()
  }

  private async handle(peer: Peer, method: string, args: unknown[]): Promise<unknown> {
    const device = this.d.store.device(peer.phone)
    if (!device) {
      peer.revoked = true
      throw new Error('MOBILE_REVOKED')
    }
    if (method === 'hello') return { version: LINK_VERSION, name: this.d.desktopName(), access: device.access }
    if (method === 'unwatch') {
      peer.watching = peer.watching.filter(id => id !== args[0])
      return null
    }
    const spec = Object.hasOwn(contract, method) ? contract[method] : undefined
    if (!spec?.mobile) throw new Error('MOBILE_UNSUPPORTED')
    if (spec.mobile === 'act' && device.access !== 'act') throw new Error('MOBILE_FORBIDDEN')
    const clean = sanitize(method, args)
    const owner = 'mobile:' + peer.phone
    if (method === 'engine:openSessionTail') {
      // 先登记再取快照：取快照期间到的事件也推过去，手机按 seq 丢掉重复的
      const id = asString(args[0])
      peer.watching = [...peer.watching.filter(w => w !== id), id].slice(-MAX_WATCHED)
    }
    const result = await this.d.call(method, clean, owner)
    if (method === 'engine:sessions') return phoneSessions(result as SessionSummary[])
    return result
  }

  // -------------------------------------------------------------------------
  // 事件、断开
  // -------------------------------------------------------------------------

  /** EventBus 的 tap：窗口收到什么，这里就看到什么 */
  hostEvent(channel: string, args: unknown[]): void {
    if (channel !== 'engine:event' || !this.peers.size) return
    const event = args[0] as HostEvent
    if (event.kind === 'session') {
      let slim: HostEvent | null = null
      for (const peer of this.peers.values())
        if (peer.watching.includes(event.sessionId)) peer.rpc.event('engine:event', (slim ??= slimForPhone(event)))
    } else if (event.kind === 'sessions') {
      this.latestSessions = event.sessions
      this.sessionsTimer ??= setTimeout(() => {
        this.sessionsTimer = null
        const sessions = this.latestSessions
        this.latestSessions = null
        if (!sessions) return
        const data = slimForPhone({ kind: 'sessions', sessions: phoneSessions(sessions) })
        for (const peer of this.peers.values()) peer.rpc.event('engine:event', data)
      }, SESSIONS_THROTTLE)
    } else if (event.kind === 'projects') {
      for (const peer of this.peers.values()) peer.rpc.event('engine:event', event)
    }
  }

  /** 中转说这部手机断开了 */
  phoneLeft(phone: string): void {
    this.drop(phone)
  }

  /** 到中转的连接断了：所有加密会话作废，手机重连后重新握手 */
  dropAll(): void {
    for (const phone of [...this.peers.keys()]) this.drop(phone)
    if (this.pairing?.status === 'confirm') this.pairing = null
  }

  /** 电脑上移除了这部手机：告诉它（手机显示「已被电脑移除」、不再自动重连），再断开 */
  revoke(phone: string): void {
    this.reject(phone)
    this.drop(phone)
  }

  /** 断开这部手机的加密会话（手机可以重新握手） */
  drop(phone: string, only?: Peer): void {
    const peer = this.peers.get(phone)
    if (!peer || (only && peer !== only)) return
    this.peers.delete(phone)
    peer.channel.fail(new Error('MOBILE_DISCONNECTED'))
    peer.rpc.close()
    this.d.changed()
  }

  close(): void {
    if (this.sessionsTimer) clearTimeout(this.sessionsTimer)
    this.sessionsTimer = null
    this.dropAll()
    this.pairing = null
  }
}
