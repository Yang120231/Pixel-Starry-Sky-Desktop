// 动画档位（docs/ui/performance.md §5.3）：只有自动，没有设置项。结果标在 <html data-perf>：
// smooth：转圈按屏幕刷新率平滑转，长回复按渲染耗时刷新（ui/markdown/tailThrottle.ts）；
// saver：转圈一圈跳 12 下，长回复最多 200 毫秒刷新一次。
// 用电池 → saver；5 秒内 3 次以上长帧 → saver，之后 30 秒没再卡才回 smooth。
// 减少动画、窗口在后台另由 data-motion / data-window-idle 管（globals.css），优先于这里。

export type PerfTier = 'smooth' | 'saver'
export type PerfReason = 'ac' | 'battery' | 'lag'

export const LONG_FRAME_MS = 50
export const LAG_FRAMES = 3
export const LAG_WINDOW_MS = 5_000
export const LAG_HOLD_MS = 30_000

export function perfTier(p: { charging: boolean; lagUntil: number; now: number }): {
  tier: PerfTier
  reason: PerfReason
} {
  if (!p.charging) return { tier: 'saver', reason: 'battery' }
  if (p.now < p.lagUntil) return { tier: 'saver', reason: 'lag' }
  return { tier: 'smooth', reason: 'ac' }
}

/**
 * 记一次长帧的结束时刻，返回新的 lagUntil。frames 是还没凑够数的长帧时刻（就地更新）；
 * 已经因为卡顿降档时，再来一次长帧就把恢复时间往后顺延
 */
export function noteLongFrame(frames: number[], at: number, lagUntil: number): number {
  if (at < lagUntil) return at + LAG_HOLD_MS
  frames.push(at)
  while (frames.length > 0 && at - frames[0]! > LAG_WINDOW_MS) frames.shift()
  if (frames.length < LAG_FRAMES) return lagUntil
  frames.length = 0
  return at + LAG_HOLD_MS
}

type Battery = EventTarget & { charging: boolean }

export function startPerfTier(): void {
  const root = document.documentElement
  let charging = true
  let lagUntil = 0
  const frames: number[] = []
  let current: PerfTier | null = null
  let timer: number | undefined
  const apply = (): void => {
    const now = performance.now()
    const { tier, reason } = perfTier({ charging, lagUntil, now })
    window.clearTimeout(timer)
    if (reason === 'lag') timer = window.setTimeout(apply, lagUntil - now + 1)
    if (tier === current) return
    // 档位变了记一行：用户说卡的时候靠它对上（没有设置项，界面上看不到）
    if (current) window.pixelsky?.log?.write('info', '动画档位', { from: current, to: tier, reason })
    current = tier
    root.dataset.perf = tier
  }
  apply()
  // 电池状态：没有电池的台式机报 charging: true；网页预览（非安全上下文）没有这个接口，按插电算
  const nav = navigator as Navigator & { getBattery?: () => Promise<Battery> }
  void nav
    .getBattery?.()
    .then(battery => {
      const update = (): void => {
        charging = battery.charging
        apply()
      }
      battery.addEventListener('chargingchange', update)
      update()
    })
    .catch(() => {})
  if (typeof PerformanceObserver === 'undefined') return
  if (!PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) return
  new PerformanceObserver(list => {
    // 窗口在后台时动画本来就停着，那时的长帧不算
    if ('windowIdle' in root.dataset) return
    const before = lagUntil
    for (const frame of list.getEntries())
      if (frame.duration > LONG_FRAME_MS) lagUntil = noteLongFrame(frames, frame.startTime + frame.duration, lagUntil)
    if (lagUntil !== before) apply()
  }).observe({ type: 'long-animation-frame' })
}
