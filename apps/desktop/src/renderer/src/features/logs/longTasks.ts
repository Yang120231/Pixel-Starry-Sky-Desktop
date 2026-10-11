// 界面卡住写进本机日志（docs/ui/logging.md §4.9）：页面一次占住主线程超过 2 秒就记一条，
// 带上离窗口回到前台多久、页面元素数和 JS 内存，用来分辨「切回窗口时卡住」是要排版的东西太多还是内存快满了。

const LONG_TASK_MS = 2_000

/** Chromium 才有的 performance.memory */
type HeapInfo = { usedJSHeapSize: number; jsHeapSizeLimit: number }

const mb = (bytes: number): number => Math.round(bytes / 1048576)

/**
 * 一次长任务要记的内容；at 是窗口回到前台、拿到焦点的时间点（performance.now，没有为 undefined）。
 * 卡住期间切回来的，焦点事件排在长任务后面才处理，时间点比长任务开始还晚：这种不记。
 */
export function longTaskFields(
  task: { startTime: number; duration: number },
  at: { visible?: number; focus?: number },
  page: { hidden: boolean; elements: number; heap?: HeapInfo },
): Record<string, unknown> {
  const after = (t: number | undefined): number | null =>
    t !== undefined && t <= task.startTime ? Math.round(task.startTime - t) : null
  const afterVisibleMs = after(at.visible)
  const afterFocusMs = after(at.focus)
  return {
    durationMs: Math.round(task.duration),
    ...(afterVisibleMs !== null ? { afterVisibleMs } : {}),
    ...(afterFocusMs !== null ? { afterFocusMs } : {}),
    hidden: page.hidden,
    elements: page.elements,
    ...(page.heap ? { heapMb: mb(page.heap.usedJSHeapSize), heapLimitMb: mb(page.heap.jsHeapSizeLimit) } : {}),
  }
}

/** 装上长任务监听；返回卸下（测试用） */
export function installLongTaskLog(): () => void {
  const bridge = window.pixelsky?.log
  if (!bridge || typeof PerformanceObserver === 'undefined') return () => {}
  if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return () => {}
  const at: { visible?: number; focus?: number } = {}
  const onVisibility = (): void => {
    if (!document.hidden) at.visible = performance.now()
  }
  const onFocus = (): void => {
    at.focus = performance.now()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onFocus)
  const observer = new PerformanceObserver(list => {
    for (const task of list.getEntries()) {
      if (task.duration < LONG_TASK_MS) continue
      const heap = (performance as Performance & { memory?: HeapInfo }).memory
      bridge.write(
        'warn',
        '界面卡住',
        longTaskFields(task, at, {
          hidden: document.hidden,
          elements: document.getElementsByTagName('*').length,
          ...(heap ? { heap } : {}),
        }),
      )
    }
  })
  observer.observe({ type: 'longtask' })
  return () => {
    observer.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', onFocus)
  }
}
