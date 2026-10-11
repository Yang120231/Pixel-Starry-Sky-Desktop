// 压缩上下文条目的数字（docs/ui/compaction.md）
import type { Item } from '@pixelsky/protocol'

export type CompactionItem = Extract<Item, { kind: 'compaction' }>

/** 进行中的计时：0:07、1:42、1:02:05 */
export function compactionClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600),
    m = Math.floor((total % 3600) / 60),
    s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** 压缩后占压缩前的比例（进度条宽度），两头都知道且压缩前大于 0 时才有；最小留一点，免得看不见 */
export function compactionRatio(item: Pick<CompactionItem, 'preTokens' | 'postTokens'>): number | null {
  const { preTokens: pre, postTokens: post } = item
  if (pre === null || post === null || pre <= 0) return null
  return Math.min(1, Math.max(0.02, post / pre))
}

/** 减少了百分之几（取整）；没变小时为 null */
export function compactionSaved(item: Pick<CompactionItem, 'preTokens' | 'postTokens'>): number | null {
  const { preTokens: pre, postTokens: post } = item
  if (pre === null || post === null || pre <= 0 || post >= pre) return null
  return Math.round((1 - post / pre) * 100)
}

/** 缓动（ease-out cubic）：t 是 0~1 的进度 */
export const easeOut = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)

/** 从 from 到 to 的缓动值，数字和进度条用同一条曲线 */
export function easeTokens(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * easeOut(t))
}
