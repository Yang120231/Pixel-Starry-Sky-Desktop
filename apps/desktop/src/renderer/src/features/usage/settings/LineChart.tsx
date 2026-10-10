import type { UsageBucket } from '@/features/usage/types'
import { SERIES_COLOR, SERIES_VALUE, columnCenter, showAllNodes, type SeriesKey } from '@/features/usage/chartGeometry'

/**
 * 折线节点图（docs/ui/usage-chart-style.md §3.2）：每个显示的系列一条 2px 直线，不堆叠、不平滑、不填充。
 * 节点 8px、外圈 2px 卡片底色；两点太近时平时只画最后一格和悬停那一格。
 * 最后一格还在累积：最后一段虚线、节点空心。
 */
export function LinePlot({
  buckets,
  keys,
  scale,
  width,
  height,
  hover,
}: {
  buckets: UsageBucket[]
  keys: readonly SeriesKey[]
  /** 纵轴最大值（niceMax 之后），0 表示没有用量 */
  scale: number
  width: number
  height: number
  hover: number | null
}) {
  if (width <= 0 || !buckets.length) return null
  const n = buckets.length
  const last = n - 1
  const x = (i: number) => columnCenter(i, n, width)
  const y = (v: number) => (scale > 0 ? height - (v / scale) * height : height)
  const allNodes = showAllNodes(n, width)
  const points = (k: SeriesKey, from: number, to: number) =>
    buckets
      .slice(from, to + 1)
      .map((b, j) => `${x(from + j).toFixed(1)},${y(SERIES_VALUE[k](b)).toFixed(1)}`)
      .join(' ')

  return (
    <svg aria-hidden width={width} height={height} className="absolute inset-0 overflow-visible">
      {hover !== null && (
        <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="var(--border-strong)" strokeWidth={1} />
      )}
      {keys.map(k => (
        <g key={k} stroke={SERIES_COLOR[k]} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
          {n > 1 && last > 1 && <polyline points={points(k, 0, last - 1)} />}
          {n > 1 && <polyline points={points(k, last - 1, last)} strokeDasharray="4 3" />}
        </g>
      ))}
      {keys.map(k =>
        buckets.map((b, i) => {
          const active = hover === i
          if (!allNodes && !active && i !== last) return null
          const cx = x(i),
            cy = y(SERIES_VALUE[k](b))
          return i === last && !active ? (
            // 进行中的一格：空心节点
            <circle
              key={`${k}-${i}`}
              cx={cx}
              cy={cy}
              r={3.5}
              fill="var(--bg-surface)"
              stroke={SERIES_COLOR[k]}
              strokeWidth={2}
            />
          ) : (
            <circle
              key={`${k}-${i}`}
              cx={cx}
              cy={cy}
              r={active ? 5 : 4}
              fill={SERIES_COLOR[k]}
              stroke="var(--bg-surface)"
              strokeWidth={2}
            />
          )
        }),
      )}
    </svg>
  )
}
