// 渲染进程报错写进本机日志（docs/ui/logging.md §4.5「renderer」）：页面报错、未处理的 Promise 拒绝、界面组件崩溃。
// 主进程按窗口限流；同一条错误短时间内重复只送一次。

const REPEAT_MS = 10_000
const recent = new Map<string, number>()

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: error.stack }
  return { message: typeof error === 'string' ? error : String(error) }
}

export function reportRendererError(kind: string, error: unknown, extra?: Record<string, unknown>): void {
  const bridge = window.pixelsky?.log
  if (!bridge) return
  const { message, stack } = describe(error)
  const key = `${kind}:${message}`
  const now = Date.now()
  if ((recent.get(key) ?? 0) > now - REPEAT_MS) return
  recent.set(key, now)
  if (recent.size > 200) recent.clear()
  bridge.write('error', message, {
    kind,
    ...(stack ? { stack: stack.split('\n').slice(0, 12).join('\n') } : {}),
    ...extra,
  })
}

/** 装上全局监听；返回卸下（测试用） */
export function installRendererErrorLog(): () => void {
  const onError = (e: ErrorEvent) =>
    reportRendererError('error', e.error ?? e.message, {
      ...(e.filename ? { source: `${e.filename}:${e.lineno}:${e.colno}` } : {}),
    })
  const onRejection = (e: PromiseRejectionEvent) => reportRendererError('unhandledrejection', e.reason)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

/**
 * React 根的错误回调：组件崩溃时带上组件栈。React 默认用 reportError 报（会触发上面的 error 监听、少了组件栈），
 * 这里换成自己记，控制台照常打印。
 */
export const reactRootErrorOptions = {
  onUncaughtError: (error: unknown, info: { componentStack?: string }) => {
    console.error(error)
    reportRendererError('react.uncaught', error, componentStack(info))
    requestReload()
  },
}

let reloadRequested = false
/** 未接住的错误会卸载整个 React 根（白屏，渲染进程还活着，崩溃恢复不会触发）：通知主进程自动重新加载，每次页面加载只报一次 */
function requestReload(): void {
  if (reloadRequested) return
  reloadRequested = true
  window.pixelsky?.log?.uncaught?.()
}

function componentStack(info: { componentStack?: string }): Record<string, unknown> {
  return info.componentStack ? { componentStack: info.componentStack.trim().split('\n').slice(0, 8).join('\n') } : {}
}
