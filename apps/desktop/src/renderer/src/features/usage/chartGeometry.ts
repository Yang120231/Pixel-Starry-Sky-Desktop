// 用量图表两种样式共用的纯函数：系列、纵轴取整、横向位置、节点收起（docs/ui/usage-chart-style.md §3）。
import type { UsageBucket } from './types'

/** 三个系列（颜色已用 dataviz 校验脚本验证，见 tokens.css --chart-*）。输入含缓存写 */
export const SERIES_KEYS = ['input', 'cache', 'output'] as const
export type SeriesKey = (typeof SERIES_KEYS)[number]

export const SERIES_VALUE: Record<SeriesKey, (b: UsageBucket) => number> = {
  input: b => b.input + b.cacheWrite,
  cache: b => b.cacheRead,
  output: b => b.output,
}

export const SERIES_COLOR: Record<SeriesKey, string> = {
  input: 'var(--chart-input)',
  cache: 'var(--chart-cache)',
  output: 'var(--chart-output)',
}

/** 两点之间少于这么多像素时，平时不画节点（只画悬停那一格和最后一格） */
export const NODE_MIN_SPACING = 12

/**
 * 纵轴最大值取整到 1 / 2 / 4 / 5 / 10 × 10^k，一半处也是整数（0、一半、最大三条网格线）。
 * 没有用量时返回 0。
 */
export function niceMax(max: number): number {
  if (!(max > 0)) return 0
  const exp = 10 ** Math.floor(Math.log10(max))
  for (const m of [1, 2, 4, 5, 10]) if (m * exp >= max) return m * exp
  return 10 * exp
}

/** 第 i 格的中心（像素）：每格等宽，和柱子、横轴刻度对齐 */
export function columnCenter(i: number, count: number, width: number): number {
  return ((i + 0.5) / count) * width
}

/** 横坐标落在哪一格（整列都是热区），超出两边取最近的一格 */
export function nearestColumn(x: number, count: number, width: number): number {
  if (count <= 0 || width <= 0) return 0
  return Math.min(count - 1, Math.max(0, Math.floor((x / width) * count)))
}

export function showAllNodes(count: number, width: number): boolean {
  return count <= 1 || width / count >= NODE_MIN_SPACING
}

/** 折线图：每格每个显示系列的值，取它们的最大值做纵轴 */
export function lineMax(buckets: UsageBucket[], keys: readonly SeriesKey[]): number {
  let max = 0
  for (const b of buckets) for (const k of keys) max = Math.max(max, SERIES_VALUE[k](b))
  return max
}

/** 柱状图：每格显示系列的和（堆叠高度），取最大值做纵轴 */
export function stackMax(buckets: UsageBucket[], keys: readonly SeriesKey[]): number {
  let max = 0
  for (const b of buckets)
    max = Math.max(
      max,
      keys.reduce((sum, k) => sum + SERIES_VALUE[k](b), 0),
    )
  return max
}
