import { tr, getLocale } from '../../i18n/core'
// 用量相关的数字格式（docs/ui/usage.md）：「不知道」显示「—」，估算加「≈」，有缺失加「≥」
import type { UsageDimension, UsageRoute, UsageTotals } from './types'

/** 1234 → 1.2k，3456789 → 3.5M */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${trim(n / 1000)}k`
  if (n < 1_000_000_000) return `${trim(n / 1_000_000)}M`
  return `${trim(n / 1_000_000_000)}B`
}

function trim(x: number): string {
  return x >= 100 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, '')
}

/** 单条费用：null → 「—」；引擎报告的费用本身是估算，前面加「≈」 */
export function formatCost(
  usd: number | null,
  source: import('@pixelsky/protocol').CostSource = 'estimate',
  billing?: import('@pixelsky/protocol').BillingSource,
): string {
  if (source === 'pending') return tr('billing.pending')
  if (source === 'unavailable') return '—'
  if (usd === null) return '—'
  if (source === 'platform')
    return `${billing === 'subscription' ? tr('billing.subscription') + ' ' : ''}${actualMoney(usd)}`
  if (usd > 0 && usd < 0.01) return '≈ <$0.01'
  return `≈ $${usd.toFixed(2)}`
}

/** 合计费用：一条都不知道 → 「—」；部分不知道 → 「≥」 */
export function actualMoney(usd: number): string {
  return usd > 0 && usd < 0.000001 ? '<$0.000001' : '$' + usd.toFixed(6).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')
}

export function formatTotalCost(t: Pick<UsageTotals, 'costUsd' | 'costKnown' | 'records' | 'costActual'>): string {
  if (t.costKnown === 0) return '—'
  const v = actualMoney(t.costUsd)
  return t.costKnown < t.records ? `≥ ${v}` : t.costActual === t.costKnown ? v : `≈ ${v}`
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function formatPercent(x: number | null): string {
  return x === null ? '—' : `${Math.round(x * 100)}%`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 明细里的时间：今天只显示时分，今年显示月-日 时分 */
export function formatTime(t: number, now = Date.now()): string {
  const d = new Date(t)
  const n = new Date(now)
  if (getLocale() === 'en-US')
    return new Intl.DateTimeFormat(getLocale(), {
      ...(d.toDateString() === n.toDateString()
        ? {}
        : { month: 'short', day: 'numeric', ...(d.getFullYear() === n.getFullYear() ? {} : { year: 'numeric' }) }),
      hour: 'numeric',
      minute: '2-digit',
    }).format(d)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.toDateString() === n.toDateString()) return hm
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}-${pad(d.getDate())} ${hm}`
  return `${d.getFullYear()}-${d.getMonth() + 1}-${pad(d.getDate())} ${hm}`
}

export const DIMENSION_LABEL: Record<UsageDimension, string> = {
  get model() {
    return tr('session.ModelSourceMenu.message291')
  },
  get project() {
    return tr('sidebar.Sidebar.message398')
  },
  get engine() {
    return tr('session.ModelSourceMenu.message283')
  },
  get route() {
    return tr('session.ModelSourceMenu.message310')
  },
}

const ROUTE_LABEL: Record<UsageRoute, string> = {
  get cli() {
    return tr('usage.format.message1044')
  },
  get pixelsky() {
    return tr('usage.format.message1045')
  },
  'api-key': 'API Key',
  get unknown() {
    return tr('settings.usage.RemoteCallsTable.message991')
  },
}

const ENGINE_LABEL: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' }

/** 分布表、筛选圆片里显示的名称 */
export function dimLabel(dim: UsageDimension, key: string): string {
  if (dim === 'route') return ROUTE_LABEL[key as UsageRoute] ?? key
  if (dim === 'engine') return ENGINE_LABEL[key] ?? key
  if (dim === 'project') return key || tr('usage.format.message1046')
  return key
}

/** 和上一期比较：返回「▲12%」「▼3%」，上一期为 0 时返回 null */
export function formatDelta(cur: number, prev: number): { text: string; up: boolean } | null {
  if (prev <= 0) return null
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (pct === 0)
    return {
      get text() {
        return tr('settings.usage.KpiCards.message969')
      },
      up: true,
    }
  return { text: `${pct > 0 ? '▲' : '▼'}${Math.abs(pct)}%`, up: pct > 0 }
}
