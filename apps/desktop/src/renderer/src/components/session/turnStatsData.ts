import { tr } from '../../i18n/core'
import type { ModelTurnUsage, TurnUsage } from '@pixelsky/protocol'
import type { ReplyStatKey } from '../../settings/replyStats'
import { actualMoney, formatCost, formatDuration, formatTokens } from '../../usage/format'

interface StatPart {
  key: ReplyStatKey
  text: string
  title: string
  mono?: boolean
}
type CountKey = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'requests'
const known = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** 所有模型先汇总再计算比例；缺失的计数不当成零，也不展示不完整的合计。 */
export function replyStatParts(usage: TurnUsage): { parts: StatPart[]; detail: string } {
  const entries = Object.entries(usage.models)
  if (!entries.length) return { parts: [], detail: '' }
  const sum = (key: CountKey): number | null => {
    let total = 0
    for (const [, model] of entries) {
      if (!known(model[key])) return null
      total += model[key]
    }
    return Number.isFinite(total) ? total : null
  }
  const input = sum('input'),
    output = sum('output'),
    cacheRead = sum('cacheRead'),
    cacheWrite = sum('cacheWrite'),
    requests = sum('requests')
  const totalInput = input !== null && cacheRead !== null && cacheWrite !== null ? input + cacheRead + cacheWrite : null
  const totalTokens = totalInput !== null && output !== null ? totalInput + output : null
  const hitRate = totalInput !== null && totalInput > 0 && cacheRead !== null ? cacheRead / totalInput : null
  const costs = entries.map(([, m]) => m.costUsd).filter(known)
  const cost = costs.reduce((a, b) => a + b, 0)
  const platform = !!usage.settlement || entries.some(([, m]) => m.costSource && m.costSource !== 'estimate')
  const pending = entries.some(([, m]) => m.costSource === 'pending')
  const subscription = entries.some(([, m]) => m.billing === 'subscription')
  const costText = platform
    ? !costs.length
      ? pending
        ? tr('billing.pending')
        : '—'
      : `${costs.length < entries.length ? '≥ ' : ''}${subscription ? tr('billing.subscription') + ' ' : ''}${actualMoney(cost)}`
    : !costs.length
      ? null
      : `${costs.length < entries.length ? '≥' : '≈'} ${cost > 0 && cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`}`
  const amount = (m: ModelTurnUsage): number => (known(m.input) ? m.input : 0) + (known(m.output) ? m.output : 0)
  const sorted = [...entries].sort((a, b) => amount(b[1]) - amount(a[1]))
  const tokens = (n: unknown): string => (known(n) ? formatTokens(n) : '—')
  const detail = sorted
    .map(([name, m]) =>
      tr('session.turnStatsData.message372', {
        p0: name,
        p1: tokens(m.input),
        p2: tokens(m.cacheRead),
        p3: tokens(m.cacheWrite),
        p4: tokens(m.output),
        p5: known(m.requests) ? m.requests : '—',
        p6: formatCost(known(m.costUsd) ? m.costUsd : null, m.costSource, m.billing),
      }),
    )
    .join('\n')
  const parts: StatPart[] = []
  if (known(usage.durationMs))
    parts.push({
      key: 'elapsed',
      text: formatDuration(usage.durationMs),
      get title() {
        return tr('session.turnStatsData.message373')
      },
    })
  if (totalInput !== null && output !== null)
    parts.push({
      key: 'tokens',
      text: `↑${formatTokens(totalInput)} ↓${formatTokens(output)}`,
      get title() {
        return tr('session.turnStatsData.message374')
      },
    })
  if (costText)
    parts.push({
      key: 'cost',
      text: costText,
      get title() {
        return platform
          ? tr(pending ? 'billing.pending' : costs.length < entries.length ? 'billing.unavailable' : 'billing.actual')
          : tr('session.turnStatsData.message375')
      },
    })
  parts.push({
    key: 'model',
    text: `${sorted[0][0]}${sorted.length > 1 ? ` +${sorted.length - 1}` : ''}`,
    get title() {
      return tr('session.ModelSourceMenu.message291')
    },
    mono: true,
  })
  const count = (key: ReplyStatKey, label: string, value: number | null, title: string): void => {
    if (value !== null) parts.push({ key, text: `${label} ${formatTokens(value)}`, title })
  }
  count('inputTokens', tr('session.turnStatsData.message376'), input, tr('session.turnStatsData.message377'))
  count('outputTokens', tr('session.live.SessionStrips.message275'), output, tr('session.turnStatsData.message378'))
  count('totalTokens', tr('session.turnStatsData.message379'), totalTokens, tr('session.turnStatsData.message380'))
  count('cacheRead', tr('session.turnStatsData.message381'), cacheRead, tr('session.turnStatsData.message382'))
  count('cacheWrite', tr('session.turnStatsData.message383'), cacheWrite, tr('session.turnStatsData.message384'))
  if (hitRate !== null)
    parts.push({
      key: 'cacheHitRate',
      text: tr('session.turnStatsData.message385', { p0: (hitRate * 100).toFixed(1).replace(/\.0$/, '') }),
      get title() {
        return tr('session.turnStatsData.message386')
      },
    })
  if (requests !== null)
    parts.push({
      key: 'requests',
      text: tr('session.turnStatsData.message387', { p0: requests }),
      get title() {
        return tr('session.turnStatsData.message388')
      },
    })
  return { parts, detail }
}
