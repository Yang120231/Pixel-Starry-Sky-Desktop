// 输入框里的上下文用量圆环：电脑把 snapshot.context 发过来，这里算百分比和读屏文字。
// 逻辑照桌面 features/session/contextData.ts 的 contextPercentage / contextNumber（手机不能导入桌面渲染进程的代码）。
import type { ContextWindow } from '@pixelsky/protocol'
import { L } from '@/i18n'

export interface ContextUsage {
  percent: number
  used: number
  window: number
}

/** 过期、压缩中、没有数据时返回 null（不画圆环）；百分比最高 100 */
export function contextUsage(c: ContextWindow | null | undefined): ContextUsage | null {
  if (!c || c.stale || c.compacting) return null
  const { used, window } = c
  if (used === null || window === null || !Number.isFinite(used) || !Number.isFinite(window) || window <= 0) return null
  return { percent: Math.min(100, (used / window) * 100), used, window }
}

export function contextNumber(value: number): string {
  if (value >= 1000000) return `${Number((value / 1000000).toFixed(2))}M`
  if (value >= 1000) return `${Number((value / 1000).toFixed(1))}k`
  return String(value)
}

export function contextLabel(u: ContextUsage): string {
  const p = Math.round(u.percent)
  const used = contextNumber(u.used)
  const window = contextNumber(u.window)
  return L(`上下文 ${p}%：已用 ${used} / ${window}`, `Context ${p}%: ${used} / ${window} used`)
}
