import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { cacheHitRate, totalTokens } from '@/usage/aggregate'
import { formatDelta, formatPercent, formatTokens, formatTotalCost } from '@/usage/format'
import type { UsageTotals } from '@/usage/types'

/** 4 个统计卡：调用轮次、Token、缓存命中、费用；都和上一个同样长度的时间段比较 */
export function KpiCards({ totals, prev }: { totals: UsageTotals; prev: UsageTotals }) {
  useI18n()
  const hit = cacheHitRate(totals)
  const prevHit = cacheHitRate(prev)
  const hitDelta = hit !== null && prevHit !== null ? Math.round((hit - prevHit) * 100) : null
  const missingCost = totals.records - totals.costKnown

  return (
    <div className="grid grid-cols-4 gap-3 @max-[700px]:grid-cols-2">
      <Card
        label={tr('settings.usage.KpiCards.message963')}
        value={`${totals.turns}`}
        unit={tr('settings.usage.KpiCards.message964')}
        sub={tr('settings.usage.KpiCards.message965', { p0: totals.requests })}
        delta={formatDelta(totals.turns, prev.turns)}
      />
      <Card
        label="Token"
        value={formatTokens(totalTokens(totals))}
        sub={tr('settings.usage.KpiCards.message966', {
          p0: formatTokens(totals.input + totals.cacheRead + totals.cacheWrite),
          p1: formatTokens(totals.output),
        })}
        delta={formatDelta(totalTokens(totals), totalTokens(prev))}
      />
      <Card
        label={tr('settings.usage.KpiCards.message967')}
        value={formatPercent(hit)}
        sub={tr('settings.usage.KpiCards.message968', { p0: formatTokens(totals.cacheRead) })}
        delta={
          hitDelta === null
            ? null
            : {
                text:
                  hitDelta === 0
                    ? tr('settings.usage.KpiCards.message969')
                    : `${hitDelta > 0 ? '▲' : '▼'}${Math.abs(hitDelta)}pt`,
                up: hitDelta >= 0,
              }
        }
      />
      <Card
        label={tr('settings.replyStats.message851')}
        value={formatTotalCost(totals)}
        sub={
          missingCost > 0
            ? tr('settings.usage.KpiCards.message970', { p0: missingCost })
            : totals.costActual === totals.costKnown && totals.costKnown > 0
              ? tr('billing.actual')
              : tr('settings.usage.KpiCards.message971')
        }
        delta={totals.costKnown > 0 && prev.costKnown > 0 ? formatDelta(totals.costUsd, prev.costUsd) : null}
      />
    </div>
  )
}

function Card({
  label,
  value,
  unit,
  sub,
  delta,
}: {
  label: string
  value: string
  unit?: string
  sub: string
  delta: { text: string; up: boolean } | null
}) {
  useI18n()
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2 text-meta text-fg-muted">
        <span className="truncate">{label}</span>
        {delta && (
          <span className="shrink-0 tabular-nums" title={tr('settings.usage.KpiCards.message972')}>
            {delta.text}
          </span>
        )}
      </div>
      <div className="mt-1 truncate text-[calc(22px*var(--font-scale,1))] leading-tight font-semibold text-fg tabular-nums">
        {value}
        {unit && <span className="ml-1 text-meta font-normal text-fg-muted">{unit}</span>}
      </div>
      <div className="mt-1 truncate text-meta text-fg-muted tabular-nums" title={sub}>
        {sub}
      </div>
    </div>
  )
}
