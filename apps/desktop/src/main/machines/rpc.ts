import type { Readable, Writable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { RpcCore } from '@pixelsky/link/rpc'

export type { RpcHandler } from '@pixelsky/link/rpc'
import type { RpcHandler } from '@pixelsky/link/rpc'

/**
 * Symmetric JSONL RPC over a private SSH channel; stdout is protocol-only.
 * 调用 / 回复 / 事件的配对在 packages/link 的 RpcCore（手机连接也用它），这里只负责按行读写和大小限制。
 */
export class RpcPeer {
  private buffer = ''
  private readonly decoder = new StringDecoder('utf8')
  private readonly core: RpcCore
  onEvent: (channel: string, data: unknown) => void = () => {}
  onClose: (error: Error) => void = () => {}
  constructor(
    input: Readable,
    private output: Writable,
    handler?: RpcHandler,
  ) {
    this.core = new RpcCore(message => this.write(message), handler, { closedMessage: 'SSH_CONNECTION_CLOSED' })
    this.core.onEvent = (channel, data) => this.onEvent(channel, data)
    this.core.onClose = error => this.onClose(error)
    input.on('data', chunk => this.receive(Buffer.isBuffer(chunk) ? this.decoder.write(chunk) : String(chunk)))
    input.on('error', error => this.close(error))
    input.on('end', () => this.close(new Error('SSH_CONNECTION_CLOSED')))
    output.on('error', error => this.close(error))
  }
  private write(value: unknown): void {
    if (this.core.isClosed) throw new Error('SSH_CONNECTION_CLOSED')
    const line = JSON.stringify(value)
    if (Buffer.byteLength(line) > 48 * 1024 * 1024 || this.output.writableLength > 64 * 1024 * 1024)
      throw new Error('RPC_SIZE_LIMIT')
    this.output.write(line + '\n')
  }
  call<T = unknown>(method: string, args: unknown[] = [], timeout = 120_000): Promise<T> {
    return this.core.call<T>(method, args, timeout)
  }
  event(channel: string, data: unknown): void {
    this.core.event(channel, data)
  }
  private receive(chunk: string): void {
    if (this.core.isClosed) return
    this.buffer += chunk
    if (this.buffer.length > 64 * 1024 * 1024) {
      this.close(new Error('RPC_SIZE_LIMIT'))
      return
    }
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (!line.trim()) continue
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch (e) {
        this.close(e as Error)
        return
      }
      this.core.receive(message)
      if (this.core.isClosed) return
    }
  }
  close(error = new Error('SSH_CONNECTION_CLOSED')): void {
    this.core.close(error)
  }
}
