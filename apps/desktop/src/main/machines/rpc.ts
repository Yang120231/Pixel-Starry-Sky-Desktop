import type { Readable, Writable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { RpcCore, RPC_SIZE_LIMIT } from '@pixelsky/link/rpc'

export type { RpcHandler } from '@pixelsky/link/rpc'
import type { RpcHandler } from '@pixelsky/link/rpc'

/**
 * Symmetric JSONL RPC over a private SSH channel; stdout is protocol-only.
 * 调用 / 回复 / 事件的配对在 packages/link 的 RpcCore（手机连接也用它），这里只负责按行读写和大小限制。
 */
export class RpcPeer {
  /** 还没收到换行的那一行，按块存着、收齐再拼一次（以前每块都把整个缓冲重拼重扫，大消息是平方级的） */
  private parts: string[] = []
  private buffered = 0
  /** 收到过合法消息：之前的非 JSON 行是远端 shell 启动文件（.bashrc 等）打印的，跳过 */
  private started = false
  private readonly decoder = new StringDecoder('utf8')
  private readonly core: RpcCore
  onEvent: (channel: string, data: unknown) => void = () => {}
  onClose: (error: Error) => void = () => {}
  private readonly channels = new Map<string, (data: unknown) => void>()
  private readonly closeListeners: (() => void)[] = []
  constructor(
    input: Readable,
    private output: Writable,
    handler?: RpcHandler,
  ) {
    this.core = new RpcCore(message => this.write(message), handler, { closedMessage: 'SSH_CONNECTION_CLOSED' })
    this.core.onEvent = (channel, data) => {
      const cb = this.channels.get(channel)
      if (cb) cb(data)
      else this.onEvent(channel, data)
    }
    this.core.onClose = error => {
      this.closeListeners.forEach(cb => cb())
      this.onClose(error)
    }
    input.on('data', chunk => this.receive(Buffer.isBuffer(chunk) ? this.decoder.write(chunk) : String(chunk)))
    input.on('error', error => this.close(error))
    input.on('end', () => this.close(new Error('SSH_CONNECTION_CLOSED')))
    output.on('error', error => this.close(error))
  }
  private write(value: unknown): void {
    if (this.core.isClosed) throw new Error('SSH_CONNECTION_CLOSED')
    let line: string
    try {
      line = JSON.stringify(value)
    } catch (e) {
      // 超过 V8 字符串上限（几百 MB 的会话）也是「这一条太大」
      if (e instanceof RangeError) throw new Error(RPC_SIZE_LIMIT)
      throw e
    }
    // 单条太大：RpcCore 只让这一次失败、连接照常；输出积压照旧断开（丢事件会让隧道数据错位、会话状态对不上）
    if (Buffer.byteLength(line) > 48 * 1024 * 1024) throw new Error(RPC_SIZE_LIMIT)
    if (this.output.writableLength > 64 * 1024 * 1024) throw new Error('RPC_BACKLOG_LIMIT')
    this.output.write(line + '\n')
  }
  call<T = unknown>(method: string, args: unknown[] = [], timeout = 120_000): Promise<T> {
    return this.core.call<T>(method, args, timeout)
  }
  event(channel: string, data: unknown): void {
    this.core.event(channel, data)
  }
  /** 按频道收事件：已注册的频道不再给 onEvent（onEvent 会被 service 整个覆盖，隧道等模块不能靠它）。 */
  handle(channel: string, cb: (data: unknown) => void): void {
    this.channels.set(channel, cb)
  }
  /** 连接关闭时通知（不占用会被覆盖的 onClose）。 */
  whenClosed(cb: () => void): void {
    this.closeListeners.push(cb)
  }
  /** 待写出的字节数：隧道据此在输出积压时暂停读源 socket，免得撞上 RPC_BACKLOG_LIMIT 把整条连接关掉。 */
  get backlog(): number {
    return this.output.writableLength
  }
  private receive(chunk: string): void {
    if (this.core.isClosed) return
    // 只在新到的这块里找换行
    for (let start = 0; ; ) {
      const newline = chunk.indexOf('\n', start)
      const piece = newline < 0 ? chunk.slice(start) : chunk.slice(start, newline)
      this.buffered += piece.length
      if (this.buffered > 64 * 1024 * 1024) {
        this.close(new Error(RPC_SIZE_LIMIT))
        return
      }
      if (piece) this.parts.push(piece)
      if (newline < 0) return
      const line = this.parts.join('')
      this.parts = []
      this.buffered = 0
      start = newline + 1
      if (!line.trim()) continue
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch (e) {
        if (!this.started) continue
        this.close(e as Error)
        return
      }
      this.started = true
      this.core.receive(message)
      if (this.core.isClosed) return
    }
  }
  close(error = new Error('SSH_CONNECTION_CLOSED')): void {
    this.core.close(error)
  }
}
