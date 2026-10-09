import type { Readable, Writable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

export type RpcHandler = (method: string, args: unknown[]) => unknown | Promise<unknown>
/** Symmetric JSONL RPC over a private SSH channel; stdout is protocol-only. */
export class RpcPeer {
  private sequence = 0
  private buffer = ''
  private readonly decoder = new StringDecoder('utf8')
  private readonly pending = new Map<
    number,
    { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }
  >()
  private closed = false
  onEvent: (channel: string, data: unknown) => void = () => {}
  onClose: (error: Error) => void = () => {}
  constructor(
    input: Readable,
    private output: Writable,
    private handler: RpcHandler = () => {
      throw new Error('Unknown RPC method')
    },
  ) {
    input.on('data', chunk => this.receive(Buffer.isBuffer(chunk) ? this.decoder.write(chunk) : String(chunk)))
    input.on('error', error => this.close(error))
    input.on('end', () => this.close(new Error('SSH_CONNECTION_CLOSED')))
    output.on('error', error => this.close(error))
  }
  private write(value: unknown): void {
    if (this.closed) throw new Error('SSH_CONNECTION_CLOSED')
    const line = JSON.stringify(value)
    if (Buffer.byteLength(line) > 48 * 1024 * 1024 || this.output.writableLength > 64 * 1024 * 1024)
      throw new Error('RPC_SIZE_LIMIT')
    this.output.write(line + '\n')
  }
  call<T = unknown>(method: string, args: unknown[] = [], timeout = 120_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('SSH_CONNECTION_CLOSED'))
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('RPC_TIMEOUT: ' + method))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.write({ id, method, args })
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e)
      }
    })
  }
  event(channel: string, data: unknown): void {
    try {
      this.write({ event: channel, data })
    } catch (e) {
      this.close(e as Error)
    }
  }
  private receive(chunk: string): void {
    if (this.closed) return
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
      try {
        const message = JSON.parse(line)
        if (typeof message.event === 'string') {
          this.onEvent(message.event, message.data)
          continue
        }
        if (!Number.isSafeInteger(message.id)) throw new Error('Invalid RPC id')
        if (typeof message.method === 'string') {
          if (!Array.isArray(message.args)) throw new Error('Invalid RPC arguments')
          void Promise.resolve()
            .then(() => this.handler(message.method, message.args))
            .then(
              result => {
                if (!this.closed) this.write({ id: message.id, result })
              },
              error => {
                if (!this.closed)
                  this.write({ id: message.id, error: error instanceof Error ? error.message : 'RPC_FAILED' })
              },
            )
            .catch(error => this.close(error))
        } else {
          const pending = this.pending.get(message.id)
          if (pending) {
            this.pending.delete(message.id)
            clearTimeout(pending.timer)
            if (message.error) pending.reject(new Error(String(message.error)))
            else pending.resolve(message.result)
          }
        }
      } catch (e) {
        this.close(e as Error)
        return
      }
    }
  }
  close(error = new Error('SSH_CONNECTION_CLOSED')): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.onClose(error)
  }
}
