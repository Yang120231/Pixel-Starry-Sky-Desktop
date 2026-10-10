import { useI18n } from '@/i18n/I18nProvider'
import { tr, getLocale } from '../../../i18n/core'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChartColumn, ChartLine } from 'lucide-react'
import { cn } from '@/ui'
import { cacheHitRate } from '@/features/usage/aggregate'
import { formatPercent, formatTokens, formatTotalCost } from '@/features/usage/format'
import type { UsageBucket } from '@/features/usage/types'
import {
  SERIES_COLOR,
  SERIES_KEYS,
  SERIES_VALUE,
  columnCenter,
  lineMax,
  nearestColumn,
  niceMax,
  stackMax,
  type SeriesKey,
} from '@/features/usage/chartGeometry'
import { setChartStyle, toggleSeries, useChartPrefs, type ChartStyle } from '@/features/usage/chartStyle'
import { LinePlot } from './LineChart'
import { BarPlot } from './DailyChart'

const SERIES_LABEL: Record<SeriesKey, () => string> = {
  input: () => tr('session.turnStatsData.input'),
  cache: () => tr('session.turnStatsData.cacheRead'),
  output: () => tr('session.live.SessionStrips.output'),
}

const STYLES: Array<{ value: ChartStyle; icon: typeof ChartLine; label: () => string }> = [
  { value: 'line', icon: ChartLine, label: () => tr('settings.usage.UsageChart.line') },
  { value: 'bar', icon: ChartColumn, label: () => tr('settings.usage.UsageChart.bar') },
]

const HEIGHT = 140
/** 设置搜索按这个标题找到图表（searchIndex.ts） */
export const CHART_SETTING_TITLE = '用量图表样式'

function bucketLabel(start: number, bucket: 'hour' | 'day'): string {
  return new Intl.DateTimeFormat(
    getLocale(),
    bucket === 'hour' ? { hour: 'numeric' } : { month: 'short', day: 'numeric' },
  ).format(new Date(start))
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/**
 * 用量图表（docs/ui/usage-chart-style.md）：折线节点图（默认）或堆叠柱状图，右上角切换；
 * 图例可以关掉系列，纵轴按剩下的重新取整；悬停 / 键盘 ← → 显示浮动明细。只有一条纵轴。
 */
export function UsageChart({ buckets, bucket }: { buckets: UsageBucket[]; bucket: 'hour' | 'day' }) {
  useI18n()
  const { style, hidden } = useChartPrefs()
  const keys = SERIES_KEYS.filter(k => !hidden.includes(k))
  const [plotRef, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const n = buckets.length
  const last = n - 1

  const totals = buckets.map(b => keys.reduce((sum, k) => sum + SERIES_VALUE[k](b), 0))
  const peak = totals.indexOf(Math.max(0, ...totals))
  const scale = niceMax(style === 'line' ? lineMax(buckets, keys) : stackMax(buckets, keys))
  const label = (i: number) => bucketLabel(buckets[i].start, bucket)
  const ticks = n > 2 ? [0, Math.floor(last / 2), last] : buckets.map((_, i) => i)
  const period =
    bucket === 'hour' ? tr('settings.usage.DailyChart.todayByHour') : tr('settings.account.PlanStore.daily')

  const move = (e: KeyboardEvent) => {
    if (!n) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const step = e.key === 'ArrowLeft' ? -1 : 1
      setHover(current => Math.min(last, Math.max(0, (current ?? (step < 0 ? n : -1)) + step)))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setHover(e.key === 'Home' ? 0 : last)
    } else if (e.key === 'Escape' && hover !== null) {
      e.stopPropagation()
      setHover(null)
    }
  }

  return (
    <div data-setting-title={CHART_SETTING_TITLE} className="rounded-md">
      <div className="mb-3 flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-2 text-meta">
        <span className="text-fg-muted tabular-nums">
          {totals[peak] > 0
            ? tr('settings.usage.DailyChart.peak', { p0: formatTokens(totals[peak]), p1: label(peak) })
            : tr('settings.usage.DailyChart.noUsageInThis')}
        </span>
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex items-center gap-1" aria-label={tr('settings.usage.DailyChart.legend')} role="group">
            {SERIES_KEYS.map(k => {
              const on = !hidden.includes(k)
              const locked = on && keys.length === 1
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  aria-disabled={locked || undefined}
                  title={
                    locked
                      ? tr('settings.usage.UsageChart.keepOne')
                      : tr('settings.usage.UsageChart.toggleSeries', { p0: SERIES_LABEL[k]() })
                  }
                  onClick={() => toggleSeries(k)}
                  className={cn(
                    'flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover',
                    on ? 'text-fg-muted' : 'text-fg-faint line-through opacity-60',
                    locked && 'cursor-default hover:bg-transparent',
                  )}
                >
                  <span className="size-2 rounded-[2px]" style={{ background: SERIES_COLOR[k] }} />
                  {SERIES_LABEL[k]()}
                </button>
              )
            })}
          </div>
          <div
            role="radiogroup"
            aria-label={tr('settings.usage.UsageChart.style')}
            className="inline-flex rounded-md bg-subtle p-0.5"
          >
            {STYLES.map(({ value, icon: Icon, label: name }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={style === value}
                aria-label={name()}
                title={name()}
                onClick={() => setChartStyle(value)}
                className={cn(
                  'press inline-flex size-6 items-center justify-center rounded-[5px] border',
                  style === value
                    ? 'border-line bg-surface text-fg shadow-sm'
                    : 'border-transparent text-fg-muted hover:text-fg',
                )}
              >
                <Icon size={14} strokeWidth={1.5} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {/* 纵轴：0、一半、最大三格 */}
        <div
          aria-hidden
          className="relative w-9 shrink-0 text-right text-label text-fg-faint tabular-nums"
          style={{ height: HEIGHT }}
        >
          {scale > 0 &&
            [1, 0.5].map(f => (
              <span key={f} className="absolute right-0 -translate-y-1/2" style={{ top: (1 - f) * HEIGHT }}>
                {formatTokens(scale * f)}
              </span>
            ))}
          <span className="absolute right-0 bottom-0 translate-y-1/2">0</span>
        </div>

        <div
          ref={plotRef}
          role="img"
          tabIndex={0}
          aria-label={tr(
            style === 'line' ? 'settings.usage.UsageChart.lineAria' : 'settings.usage.DailyChart.usageChartPeak',
            { p0: period, p1: formatTokens(totals[peak] ?? 0) },
          )}
          aria-description={tr('settings.usage.UsageChart.keyboardHint')}
          className="relative min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
          style={{ height: HEIGHT }}
          onMouseMove={e => {
            const rect = e.currentTarget.getBoundingClientRect()
            setHover(nearestColumn(e.clientX - rect.left, n, rect.width))
          }}
          onMouseLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={move}
        >
          {/* 网格线：最大、一半淡线，底边实线 */}
          {scale > 0 &&
            [0, 0.5].map(f => (
              <span
                key={f}
                aria-hidden
                className="absolute inset-x-0 border-t border-line-subtle"
                style={{ top: f * HEIGHT }}
              />
            ))}
          <span aria-hidden className="absolute inset-x-0 bottom-0 border-t border-line" />
          {style === 'line' ? (
            <LinePlot buckets={buckets} keys={keys} scale={scale} width={width} height={HEIGHT} hover={hover} />
          ) : (
            <BarPlot buckets={buckets} keys={keys} scale={scale} height={HEIGHT} hover={hover} />
          )}
          {hover !== null && width > 0 && buckets[hover] && (
            <Tooltip
              bucket={buckets[hover]}
              title={label(hover)}
              current={hover === last}
              x={columnCenter(hover, n, width)}
              flip={columnCenter(hover, n, width) > width / 2}
            />
          )}
        </div>
      </div>

      <div className="relative mt-1.5 ml-11 h-4 text-label text-fg-faint tabular-nums">
        {ticks.map(i => (
          <span
            key={i}
            className="absolute top-0 whitespace-nowrap"
            style={
              i === 0
                ? { left: 0 }
                : i === last
                  ? { right: 0 }
                  : { left: `${((i + 0.5) / n) * 100}%`, transform: 'translateX(-50%)' }
            }
          >
            {i === last
              ? bucket === 'hour'
                ? tr('settings.usage.DailyChart.now')
                : tr('settings.usage.DailyChart.today')
              : label(i)}
          </span>
        ))}
      </div>

      {/* 键盘换格时读屏读出这一格 */}
      <p className="sr-only" aria-live="polite">
        {hover !== null && buckets[hover] ? summary(buckets[hover], label(hover), hover === last) : ''}
      </p>
    </div>
  )
}

function summary(b: UsageBucket, title: string, current: boolean): string {
  const parts = SERIES_KEYS.map(k => `${SERIES_LABEL[k]()} ${formatTokens(SERIES_VALUE[k](b))}`)
  return [
    current ? `${title}（${tr('settings.usage.UsageChart.inProgress')}）` : title,
    ...parts,
    `${tr('settings.usage.KpiCards.cacheHit')} ${formatPercent(cacheHitRate(b))}`,
    `${tr('settings.replyStats.cost')} ${formatTotalCost(b)}`,
  ].join('，')
}

/** 浮动明细：数值用正文色，系列只靠左边的色块区分；靠右半边时翻到左侧 */
function Tooltip({
  bucket: b,
  title,
  current,
  x,
  flip,
}: {
  bucket: UsageBucket
  title: string
  current: boolean
  x: number
  flip: boolean
}) {
  useI18n()
  const row = (name: string, value: string, color: string) => (
    <div key={name} className="flex items-center gap-2">
      <span className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
      <span className="flex-1 text-fg-secondary">{name}</span>
      <span className="text-fg tabular-nums">{value}</span>
    </div>
  )
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 z-10 min-w-44 rounded-lg border border-line bg-popover px-3 py-2 text-meta whitespace-nowrap shadow-popover"
      style={{ left: x, transform: flip ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}
    >
      <div className="mb-1.5 font-medium text-fg">
        {title}
        {current && (
          <span className="ml-1.5 font-normal text-fg-muted">{tr('settings.usage.UsageChart.inProgress')}</span>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        {SERIES_KEYS.map(k => row(SERIES_LABEL[k](), formatTokens(SERIES_VALUE[k](b)), SERIES_COLOR[k]))}
      </div>
      {/* 不画在图上的几项：两列排，明细不至于比图还高 */}
      <div className="mt-1.5 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 border-t border-line-subtle pt-1.5">
        {[
          [tr('settings.usage.DailyChart.total'), formatTokens(b.input + b.cacheRead + b.cacheWrite + b.output)],
          [tr('settings.usage.UsageChart.cacheWriteIncluded'), formatTokens(b.cacheWrite)],
          [tr('settings.usage.KpiCards.cacheHit'), formatPercent(cacheHitRate(b))],
          [tr('settings.replyStats.cost'), formatTotalCost(b)],
          [tr('settings.usage.Distribution.turns'), String(b.turns)],
        ].map(([name, value]) => (
          <div key={name} className="flex justify-between gap-2">
            <span className="text-fg-muted">{name}</span>
            <span className="text-fg tabular-nums">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
