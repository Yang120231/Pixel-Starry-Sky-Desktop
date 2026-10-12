// 模拟进度：拿不到真实百分比时（压缩上下文、安装 / 更新引擎），按预计用时走一条越来越慢的曲线。
// 到预计用时大约 83%，之后只会慢慢逼近 92%，不会自己走满；真的做完了由调用方直接给满格
import { useEffect, useState } from 'react'

/** 模拟进度的上限 */
export const SIMULATED_CAP = 0.92

/** elapsedMs 时的进度（0~0.92）；expectedMs 是预计用时 */
export function simulated(elapsedMs: number, expectedMs: number): number {
  if (elapsedMs <= 0 || expectedMs <= 0) return 0
  return SIMULATED_CAP * (1 - Math.exp((-2.3 * elapsedMs) / expectedMs))
}

/** 一组数的中位数；空数组为 null */
export function median(values: readonly number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export interface SimulatedProgress {
  /** 0~0.92 */
  value: number
  elapsedMs: number
  /** 超过预计用时两倍 */
  slow: boolean
}

/** active 时每 200 ms（减少动画时每秒）按 startedAt 重算一次 */
export function useSimulatedProgress(
  startedAt: number,
  expectedMs: number,
  active: boolean,
  reduced = false,
): SimulatedProgress {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), reduced ? 1000 : 200)
    return () => window.clearInterval(t)
  }, [active, reduced])
  const elapsedMs = Math.max(0, now - startedAt)
  return { value: simulated(elapsedMs, expectedMs), elapsedMs, slow: elapsedMs > expectedMs * 2 }
}
