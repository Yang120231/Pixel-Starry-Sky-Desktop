/**
 * 退出时要停的服务（引擎进程、终端、SSH 连接、项目服务等）。
 * 窗口 / 文件 / 终端的确认都结束后才调用 `shutdown`；各项并行执行，只执行一次，一项失败不影响其他项。
 * 注册顺序由初始化顺序决定（machines → 终端 → 引擎 → 内置浏览器 → 项目服务），只用于排查，不代表先后。
 */
export class Lifecycle {
  private readonly tasks = new Set<() => Promise<void> | void>()
  private pending: Promise<void> | null = null

  onShutdown(task: () => Promise<void> | void): void {
    this.tasks.add(task)
  }

  shutdown(): Promise<void> {
    return (this.pending ??= Promise.allSettled([...this.tasks].map(task => Promise.resolve().then(task))).then(
      results => {
        for (const result of results) if (result.status === 'rejected') console.error('Shutdown:', result.reason)
      },
    ))
  }
}
