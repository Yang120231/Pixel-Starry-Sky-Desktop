import { useId } from 'react'
import type { UsageBucket } from '@/features/usage/types'
import {
  SERIES_COLOR,
  SERIES_VALUE,
  columnCenter,
  monotoneSegments,
  segmentsPath,
  showAllNodes,
  type SeriesKey,
} from '@/features/usage/chartGeometry'

/** 曲线下的渐变填充：顶上这么不透明，到底边变成 0 */
const FILL_OPACITY = 0.1

/**
 * 折线节点图（docs/ui/usage-chart-style.md §3.2、§8）：每个显示的系列一条 2px 单调三次曲线（经过每个点、
 * 两点之间不冲过真实值），下面一层很淡的渐变填充，不堆叠。
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
  // useId 带冒号，放进 url(#…) 前去掉
  const id = 'usage-fill' + useId().replace(/[^\w-]/g, '')
  if (width <= 0 || !buckets.length) return null
  const n = buckets.length
  const last = n - 1
  const x = (i: number) => columnCenter(i, n, width)
  const y = (v: number) => (scale > 0 ? height - (v / scale) * height : height)
  const allNodes = showAllNodes(n, width)
  const curve = (k: SeriesKey) => monotoneSegments(buckets.map((b, i) => ({ x: x(i), y: y(SERIES_VALUE[k](b)) })))
  const gradient = (k: SeriesKey) => `${id}-${k}`

  return (
    <svg aria-hidden width={width} height={height} className="absolute inset-0 overflow-visible">
      <defs>
        {keys.map(k => (
          <linearGradient key={k} id={gradient(k)} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={SERIES_COLOR[k]} stopOpacity={FILL_OPACITY} />
            <stop offset="100%" stopColor={SERIES_COLOR[k]} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      {hover !== null && (
        <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="var(--border-strong)" strokeWidth={1} />
      )}
      {/* 先画所有填充，再画线：线不会被别的系列的填充盖住 */}
      {n > 1 &&
        keys.map(k => {
          const line = segmentsPath(curve(k))
          return (
            <path
              key={`fill-${k}`}
              d={`${line}L${x(last).toFixed(1)},${height}L${x(0).toFixed(1)},${height}Z`}
              fill={`url(#${gradient(k)})`}
              stroke="none"
            />
          )
        })}
      {n > 1 &&
        keys.map(k => {
          const segments = curve(k)
          return (
            <g
              key={k}
              stroke={SERIES_COLOR[k]}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            >
              {last > 1 && <path d={segmentsPath(segments.slice(0, last - 1))} />}
              <path d={segmentsPath(segments.slice(last - 1))} strokeDasharray="4 3" />
            </g>
          )
        })}
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
