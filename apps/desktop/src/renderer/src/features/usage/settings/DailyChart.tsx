import type { UsageBucket } from '@/features/usage/types'
import { BAR_COLOR, SERIES_VALUE, barGeometry, type SeriesKey } from '@/features/usage/chartGeometry'

/**
 * 堆叠柱状图（docs/ui/usage-chart-style.md §8）：参考 Claude 用量页——同一冷色系三档明暗，段与段之间不留缝，
 * 柱间留柱宽约 15%，顶上 2px 圆角；柱子太宽（7 天）时最多 36px、居中。不引入图表库，用 div 画。
 * 只画显示的系列，高度按纵轴最大值（scale）换算；悬停的那一根之外变淡。标题行、图例、浮动明细在 UsageChart 里。
 */
export function BarPlot({
  buckets,
  keys,
  scale,
  width,
  height,
  hover,
}: {
  buckets: UsageBucket[]
  keys: readonly SeriesKey[]
  scale: number
  width: number
  height: number
  hover: number | null
}) {
  if (width <= 0) return null
  const { slot, bar, offset } = barGeometry(buckets.length, width)
  return (
    <div aria-hidden className="absolute inset-0">
      {buckets.map((b, i) => {
        const values = keys.map(k => SERIES_VALUE[k](b))
        const total = values.reduce((sum, v) => sum + v, 0)
        if (!(scale > 0) || total <= 0) return null
        const full = (total / scale) * height
        return (
          <div
            key={b.start}
            className="absolute bottom-0 flex flex-col-reverse overflow-hidden rounded-t-[2px] transition-opacity duration-(--dur-base)"
            style={{
              left: i * slot + offset,
              width: bar,
              height: Math.max(1, full),
              opacity: hover === null || hover === i ? 1 : 0.45,
            }}
          >
            {values.map((v, j) =>
              v > 0 ? (
                <div
                  key={keys[j]}
                  className="w-full shrink-0"
                  // 很小的一段也至少 1px，免得完全看不见
                  style={{ background: BAR_COLOR[keys[j]], height: Math.max(1, (v / total) * full) }}
                />
              ) : null,
            )}
          </div>
        )
      })}
    </div>
  )
}
