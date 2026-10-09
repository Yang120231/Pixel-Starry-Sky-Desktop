import { useI18n } from '@/i18n/I18nProvider'
import { tr, getLocale } from '../../../i18n/core'
import { useState } from 'react'
import { formatTokens, formatTotalCost } from '@/features/usage/format'
import type { UsageBucket } from '@/features/usage/types'

/** 三个系列（颜色已用 dataviz 校验脚本验证，见 tokens.css --chart-*）。输入含缓存写 */
const SERIES = [
  {
    key: 'input',
    get label() {
      return tr('session.turnStatsData.input')
    },
    color: 'bg-chart-input',
    value: (b: UsageBucket) => b.input + b.cacheWrite,
  },
  {
    key: 'cache',
    get label() {
      return tr('session.turnStatsData.cacheRead')
    },
    color: 'bg-chart-cache',
    value: (b: UsageBucket) => b.cacheRead,
  },
  {
    key: 'output',
    get label() {
      return tr('session.live.SessionStrips.output')
    },
    color: 'bg-chart-output',
    value: (b: UsageBucket) => b.output,
  },
] as const

const HEIGHT = 140
/** 堆叠的段与段之间留 2px 底色缝 */
const GAP = 2

function bucketLabel(start: number, bucket: 'hour' | 'day'): string {
  const d = new Date(start)
  return new Intl.DateTimeFormat(
    getLocale(),
    bucket === 'hour' ? { hour: 'numeric' } : { month: 'short', day: 'numeric' },
  ).format(d)
}

/**
 * 每日（今天按小时）用量堆叠柱状图：不引入图表库，用 div 画。
 * 悬停一根柱子在图上方显示那一格的明细；没有悬停时显示峰值。
 */
export function DailyChart({ buckets, bucket }: { buckets: UsageBucket[]; bucket: 'hour' | 'day' }) {
  useI18n()
  const [hover, setHover] = useState<number | null>(null)
  const totals = buckets.map(b => SERIES.reduce((sum, s) => sum + s.value(b), 0))
  const max = Math.max(1, ...totals)
  const peak = totals.indexOf(Math.max(...totals))
  const shown = hover ?? null
  const label = (i: number) => bucketLabel(buckets[i].start, bucket)
  // 横轴只标首、中、末三个点（末格是「今天」或「现在」）
  const ticks =
    buckets.length > 2 ? [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1] : buckets.map((_, i) => i)

  return (
    <div>
      <div className="mb-3 flex min-h-5 items-center justify-between gap-3 text-meta">
        {shown !== null ? (
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-fg-secondary tabular-nums">
            <span className="font-medium text-fg">{label(shown)}</span>
            {SERIES.map(s => (
              <span key={s.key} className="flex items-center gap-1">
                <span className={`size-2 rounded-[2px] ${s.color}`} />
                {s.label} {formatTokens(s.value(buckets[shown]))}
              </span>
            ))}
            <span>
              {tr('settings.replyStats.cost')} {formatTotalCost(buckets[shown])}
            </span>
            <span>
              {tr('settings.usage.DailyChart.total')} {formatTokens(totals[shown])}
            </span>
          </span>
        ) : (
          <span className="text-fg-muted tabular-nums">
            {totals[peak] > 0
              ? tr('settings.usage.DailyChart.peak', { p0: formatTokens(totals[peak]), p1: label(peak) })
              : tr('settings.usage.DailyChart.noUsageInThis')}
          </span>
        )}
        <span
          className="flex shrink-0 items-center gap-3 text-fg-muted"
          aria-label={tr('settings.usage.DailyChart.legend')}
        >
          {SERIES.map(s => (
            <span key={s.key} className="flex items-center gap-1">
              <span className={`size-2 rounded-[2px] ${s.color}`} />
              {s.label}
            </span>
          ))}
        </span>
      </div>

      <div
        role="img"
        aria-label={tr('settings.usage.DailyChart.usageChartPeak', {
          p0: bucket === 'hour' ? '今天每小时' : '每日',
          p1: formatTokens(totals[peak]),
        })}
        className="flex items-end gap-[2px] border-b border-line"
        style={{ height: HEIGHT }}
        onMouseLeave={() => setHover(null)}
      >
        {buckets.map((b, i) => {
          const values = SERIES.map(s => s.value(b))
          const visible = values.filter(v => v > 0).length
          const usable = Math.max(0, (totals[i] / max) * HEIGHT - GAP * Math.max(0, visible - 1))
          let topIndex = -1
          values.forEach((v, k) => {
            if (v > 0) topIndex = k
          })
          return (
            // 整根柱子的高度都是悬停区域，比柱子本身好点中
            <div
              key={b.start}
              className="flex h-full min-w-0 flex-1 cursor-default flex-col-reverse"
              onMouseEnter={() => setHover(i)}
            >
              {values.map((v, k) =>
                v > 0 ? (
                  <div
                    key={SERIES[k].key}
                    className={`${SERIES[k].color} w-full shrink-0 ${k === topIndex ? 'rounded-t-[4px]' : ''}`}
                    style={{
                      height: Math.max(1, (v / totals[i]) * usable),
                      marginTop: k === topIndex ? 0 : GAP,
                      opacity: hover === null || hover === i ? 1 : 0.45,
                    }}
                  />
                ) : null,
              )}
            </div>
          )
        })}
      </div>

      <div className="relative mt-1.5 h-4 text-label text-fg-faint tabular-nums">
        {ticks.map(i => (
          <span
            key={i}
            className="absolute top-0 whitespace-nowrap"
            style={
              i === 0
                ? { left: 0 }
                : i === buckets.length - 1
                  ? { right: 0 }
                  : { left: `${((i + 0.5) / buckets.length) * 100}%`, transform: 'translateX(-50%)' }
            }
          >
            {i === buckets.length - 1
              ? bucket === 'hour'
                ? tr('settings.usage.DailyChart.now')
                : tr('settings.usage.DailyChart.today')
              : label(i)}
          </span>
        ))}
      </div>
    </div>
  )
}
