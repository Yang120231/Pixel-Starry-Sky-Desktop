// 按消息收发的对称 RPC：调用、回复、事件三种消息。不关心消息怎么传：
// SSH 机器用 JSONL 流包一层（apps/desktop/src/main/machines/rpc.ts），手机用加密通道（channel.ts）。

export type RpcHandler = (method: string, args: unknown[]) => unknown
export type RpcMessage =
  | { id: number; method: string; args: unknown[] }
  | { id: number; result: unknown }
  | { id: number; error: string }
  | { event: string; data: unknown }

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export interface RpcOptions {
  /** 连接已关闭时调用报的错（SSH 机器沿用 SSH_CONNECTION_CLOSED） */
  closedMessage?: string
}

export class RpcCore {
  private sequence = 0
  private readonly pending = new Map<number, Pending>()
  private closed = false
  private readonly closedMessage: string
  onEvent: (channel: string, data: unknown) => void = () => {}
  onClose: (error: Error) => void = () => {}

  constructor(
    /** 发出一条消息；抛错表示发不出去（太大、连接断了） */
    private readonly output: (message: RpcMessage) => void,
    private readonly handler: RpcHandler = () => {
      throw new Error('Unknown RPC method')
    },
    options: RpcOptions = {},
  ) {
    this.closedMessage = options.closedMessage ?? 'LINK_CLOSED'
  }

  get isClosed(): boolean {
    return this.closed
  }

  call<T = unknown>(method: string, args: unknown[] = [], timeout = 120_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error(this.closedMessage))
    return new Promise<T>((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('RPC_TIMEOUT: ' + method))
      }, timeout)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      try {
        this.output({ id, method, args })
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e as Error)
      }
    })
  }

  event(channel: string, data: unknown): void {
    if (this.closed) return
    try {
      this.output({ event: channel, data })
    } catch (e) {
      this.close(e as Error)
    }
  }

  /** 收到一条已经解析好的消息；格式不对就关闭（对方不可信或协议不一致） */
  receive(raw: unknown): void {
    if (this.closed) return
    const message = (raw ?? {}) as Record<string, unknown>
    try {
      if (typeof message.event === 'string') {
        this.onEvent(message.event, message.data)
        return
      }
      const id = message.id
      if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new Error('Invalid RPC id')
      if (typeof message.method === 'string') {
        if (!Array.isArray(message.args)) throw new Error('Invalid RPC arguments')
        const method = message.method,
          args = message.args
        void Promise.resolve()
          .then(() => this.handler(method, args))
          .then(
            result => {
              if (!this.closed) this.output({ id, result })
            },
            error => {
              if (!this.closed) this.output({ id, error: error instanceof Error ? error.message : 'RPC_FAILED' })
            },
          )
          .catch(error => this.close(error as Error))
        return
      }
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(String(message.error)))
      else pending.resolve(message.result)
    } catch (e) {
      this.close(e as Error)
    }
  }

  close(error?: Error): void {
    if (this.closed) return
    this.closed = true
    const reason = error ?? new Error(this.closedMessage)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(reason)
    }
    this.pending.clear()
    this.onClose(reason)
  }
}
