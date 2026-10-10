import type { UsageBucket } from '@/features/usage/types'
import { SERIES_COLOR, SERIES_VALUE, type SeriesKey } from '@/features/usage/chartGeometry'

/** 堆叠的段与段之间留 2px 底色缝 */
const GAP = 2

/**
 * 堆叠柱状图：不引入图表库，用 div 画（docs/ui/usage.md §7）。只画显示的系列，高度按纵轴最大值（scale）换算；
 * 悬停的那一根之外变淡。标题行、图例、浮动明细在 UsageChart 里。
 */
export function BarPlot({
  buckets,
  keys,
  scale,
  height,
  hover,
}: {
  buckets: UsageBucket[]
  keys: readonly SeriesKey[]
  scale: number
  height: number
  hover: number | null
}) {
  return (
    <div aria-hidden className="absolute inset-0 flex items-end gap-[2px]">
      {buckets.map((b, i) => {
        const values = keys.map(k => SERIES_VALUE[k](b))
        const total = values.reduce((sum, v) => sum + v, 0)
        const visible = values.filter(v => v > 0).length
        const usable = scale > 0 ? Math.max(0, (total / scale) * height - GAP * Math.max(0, visible - 1)) : 0
        let topIndex = -1
        values.forEach((v, j) => {
          if (v > 0) topIndex = j
        })
        return (
          <div key={b.start} className="flex h-full min-w-0 flex-1 flex-col-reverse">
            {values.map((v, j) =>
              v > 0 ? (
                <div
                  key={keys[j]}
                  className={`w-full shrink-0 ${j === topIndex ? 'rounded-t-[4px]' : ''}`}
                  style={{
                    background: SERIES_COLOR[keys[j]],
                    height: Math.max(1, (v / total) * usable),
                    marginTop: j === topIndex ? 0 : GAP,
                    opacity: hover === null || hover === i ? 1 : 0.45,
                  }}
                />
              ) : null,
            )}
          </div>
        )
      })}
    </div>
  )
}
