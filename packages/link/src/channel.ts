// 握手之后的加密通道：JSON → （超过 1 KB 先压缩）→ 加密 → 数据帧。
// 压缩由各平台提供（电脑用 zlib，手机用 CompressionStream），所以收发是异步的；
// 发送和接收各排一条队，保证顺序和计数一致。任何一帧解不开，通道就作废，调用方断开后重新握手。
import { concat } from './bytes'
import { FrameType, MAX_PAYLOAD, decodeJson, encodeFrame, encodeJson } from './frame'
import type { HandshakeResult } from './noise'

export interface Codec {
  /** deflate-raw 压缩 */
  deflate(bytes: Uint8Array): Promise<Uint8Array> | Uint8Array
  /** deflate-raw 解压；解出来超过 maxBytes 就抛错（防压缩炸弹） */
  inflate(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> | Uint8Array
}

const RAW = 0
const DEFLATE = 1
/** 小于这个大小的不压缩（M0：压缩对小帧没有好处） */
const COMPRESS_FROM = 1024
/** 解压后的上限 */
const INFLATED_LIMIT = 16 * 1024 * 1024

export class SecureChannel {
  private sending: Promise<void> = Promise.resolve()
  private receiving: Promise<void> = Promise.resolve()
  private broken: Error | null = null

  constructor(
    private readonly keys: HandshakeResult,
    /** 发出一个完整的帧 */
    private readonly output: (frame: Uint8Array) => void,
    /** 收到一条消息（按到达顺序） */
    private readonly onMessage: (value: unknown) => void,
    /** 通道作废（解不开、解压失败、发不出去）；只调用一次 */
    private readonly onError: (error: Error) => void,
    private readonly codec: Codec | null = null,
  ) {}

  get closed(): boolean {
    return this.broken !== null
  }

  send(value: unknown): Promise<void> {
    const task = this.sending.then(async () => {
      if (this.broken) throw this.broken
      const json = encodeJson(value)
      const body =
        this.codec && json.length >= COMPRESS_FROM
          ? concat(Uint8Array.of(DEFLATE), await this.codec.deflate(json))
          : concat(Uint8Array.of(RAW), json)
      if (body.length > MAX_PAYLOAD) throw new Error('LINK_FRAME_TOO_LARGE')
      this.output(encodeFrame(FrameType.Data, this.keys.send.seal(body)))
    })
    // 太大的一条只让这一次调用失败；加密或发送出错则整个通道作废
    this.sending = task.catch(error => {
      if ((error as Error).message !== 'LINK_FRAME_TOO_LARGE') this.fail(error as Error)
    })
    return task
  }

  /** 收到数据帧的内容（不含帧类型字节） */
  receive(body: Uint8Array): void {
    if (this.broken) return
    let plain: Uint8Array
    try {
      // 解密必须按到达顺序同步做：计数和对方的发送顺序一一对应
      plain = this.keys.receive.open(body)
    } catch (error) {
      this.fail(error as Error)
      return
    }
    this.receiving = this.receiving.then(async () => {
      if (this.broken) return
      try {
        const flag = plain[0],
          data = plain.subarray(1)
        if (flag === DEFLATE && !this.codec) throw new Error('LINK_BAD_FRAME')
        if (flag !== RAW && flag !== DEFLATE) throw new Error('LINK_BAD_FRAME')
        const json = flag === DEFLATE ? await this.codec!.inflate(data, INFLATED_LIMIT) : data
        this.onMessage(decodeJson(json))
      } catch (error) {
        this.fail(error as Error)
      }
    })
  }

  fail(error: Error): void {
    if (this.broken) return
    this.broken = error
    this.onError(error)
  }
}
