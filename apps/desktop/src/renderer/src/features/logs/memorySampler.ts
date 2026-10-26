// 界面进程的内存采样（docs/ui/renderer-memory.md §3.2.1）：默认每 60 秒一次，经 log.sample() 报给主进程，
// 主进程补上自己那边的数，再按回复里的间隔（内存紧时 10 秒）排下一次。采样一次 O(快照条目数)，几万条也就几毫秒。
import type { RendererMemorySample } from '../../../../shared/types/memory'
import { getEngineState } from '@/features/engine/store'
import { snapshotStats } from '@/features/engine/snapshotStats'
import { keepAliveFor, mountedTabCount, setKeepAliveLimit } from '@/features/panes/keepAlive'
import { transcriptViewStats } from '@/features/session/live/transcriptPlaces'
import { screens } from '@/features/terminal/screens'
import { editorCount } from '@/features/editor/code/CodeEditor'
import { isLightweight } from '@/features/recovery/lightweight'
import { pageElements } from './longTasks'

import { DEFAULT_INTERVAL_MS, nextInterval } from './samplerInterval'

type HeapInfo = { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }

const MB = 1048576
const mb = (bytes: number): number => Math.round((bytes / MB) * 10) / 10

/** 现在的采样（没有 performance.memory 时堆的三项是 0） */
export function collectSample(): RendererMemorySample {
  const heap = (performance as Performance & { memory?: HeapInfo }).memory
  const stats = snapshotStats(getEngineState().snapshots)
  const views = transcriptViewStats()
  let terminalLines = 0
  screens.forEach(screen => {
    terminalLines += screen.lines()
  })
  return {
    heapUsedMb: heap ? mb(heap.usedJSHeapSize) : 0,
    heapTotalMb: heap ? mb(heap.totalJSHeapSize) : 0,
    heapLimitMb: heap ? mb(heap.jsHeapSizeLimit) : 0,
    elements: pageElements(),
    mountedTabs: mountedTabCount(),
    sessionViews: views.sessionViews,
    shownTurnsMax: views.shownTurnsMax,
    snapshots: stats.snapshots,
    snapshotItems: stats.items,
    // 文字按 2 字节 / 字符折算；base64 只数长度
    snapshotTextMb: mb(stats.textChars * 2),
    imageB64Mb: mb(stats.imageChars),
    terminals: screens.size,
    terminalLines,
    codeEditors: editorCount(),
    lightweight: isLightweight(),
  }
}

/** 装上采样；返回卸下（测试用）。没有日志桥（演示模式、浏览器）不装 */
export function installMemorySampler(): () => void {
  const bridge = window.pixelsky?.log
  if (!bridge?.sample) return () => {}
  let timer: number | undefined
  let stopped = false
  const tick = (): void => {
    let interval = DEFAULT_INTERVAL_MS
    const next = (): void => {
      if (!stopped) timer = window.setTimeout(tick, interval)
    }
    try {
      const sample = collectSample()
      bridge
        .sample(sample)
        .then(reply => {
          interval = nextInterval(reply)
          // 切走的对话保留几个跟着内存走；轻量模式固定 0（lightweight.ts）
          if (typeof reply?.freeMb === 'number' && !isLightweight())
            setKeepAliveLimit(keepAliveFor(reply.freeMb, sample.heapUsedMb))
        })
        .catch(() => {})
        .finally(next)
    } catch {
      next()
    }
  }
  // 启动后先等一会儿再报第一条，不和首屏渲染抢
  timer = window.setTimeout(tick, 5_000)
  return () => {
    stopped = true
    window.clearTimeout(timer)
  }
}
