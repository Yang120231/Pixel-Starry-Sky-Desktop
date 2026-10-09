/**
 * 可取消的查询（全局搜索、产物扫描）：每个调用方同时只跑最新的一次。
 * 调用方的键由使用者决定：本机按窗口（webContents id），远端辅助进程只有桌面端一个调用方。
 */
export class SearchRegistry {
  private readonly jobs = new Map<string, { requestId: number; controller: AbortController }>()

  /**
   * 开始一次查询：同一调用方更早的查询被中止；更新的请求已经开始时（旧请求晚到），
   * 不执行、直接返回 `cancelled()`。查询因中止而失败时同样返回 `cancelled()`。
   */
  async begin<T>(
    owner: string,
    requestId: number,
    work: (signal: AbortSignal) => Promise<T> | T,
    cancelled: () => T,
  ): Promise<T> {
    const old = this.jobs.get(owner)
    if (old && old.requestId > requestId) return cancelled()
    old?.controller.abort()
    const job = { requestId, controller: new AbortController() }
    this.jobs.set(owner, job)
    try {
      return await work(job.controller.signal)
    } catch (err) {
      if (!job.controller.signal.aborted) throw err
      return cancelled()
    } finally {
      if (this.jobs.get(owner) === job) this.jobs.delete(owner)
    }
  }

  /** 只取消指定请求号的查询（已被更新的请求替换时不动） */
  cancel(owner: string, requestId: unknown): void {
    const job = this.jobs.get(owner)
    if (job && job.requestId === requestId) job.controller.abort()
  }

  /** 调用方没了（窗口关闭）：中止并忘掉它的查询 */
  release(owner: string): void {
    this.jobs.get(owner)?.controller.abort()
    this.jobs.delete(owner)
  }
}
