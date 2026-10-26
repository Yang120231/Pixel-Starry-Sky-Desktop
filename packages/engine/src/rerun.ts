// 引擎检测这类「同一时间只跑一次」的任务：在跑时又要求重来（换了账号，在跑的那次取的是旧环境），
// 等它跑完再跑一次；期间再要求多少次都只多跑这一次。不要求重来的照旧并入在跑的那次

export class Rerun<T> {
  private running: Promise<T> | null = null
  private queued: Promise<T> | null = null

  constructor(private readonly task: () => Promise<T>) {}

  /** 在跑或排着的最新那次；都没有为 null */
  pending(): Promise<T> | null {
    return this.queued ?? this.running
  }

  run(again = false): Promise<T> {
    const pending = this.pending()
    if (!pending) return this.start()
    if (!again || this.queued) return pending
    this.queued = this.running!.catch(() => undefined).then(() => {
      this.queued = null
      return this.start()
    })
    return this.queued
  }

  private start(): Promise<T> {
    const p: Promise<T> = this.task().finally(() => {
      if (this.running === p) this.running = null
    })
    this.running = p
    return p
  }
}
