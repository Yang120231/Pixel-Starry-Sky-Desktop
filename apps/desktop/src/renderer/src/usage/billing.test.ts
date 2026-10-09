import { afterEach, describe, expect, it } from 'vitest'
import { formatCost, formatTotalCost } from './format'
import { setCurrentLocale } from '../i18n/core'
import { replyStatParts } from '../components/session/turnStatsData'
afterEach(() => setCurrentLocale('zh-CN'))
describe('billing labels', () => {
  it('shows precise actual subscription amounts and translates pending states', () => {
    expect(formatCost(0.0034, 'platform', 'subscription')).toBe('订阅 $0.0034')
    expect(formatCost(0, 'platform')).toBe('$0')
    expect(formatCost(90, 'pending')).toBe('费用结算中…')
    expect(formatCost(90, 'unavailable')).toBe('—')
    setCurrentLocale('en-US')
    expect(formatCost(null, 'pending')).toBe('Settling cost…')
    expect(formatCost(0.0034, 'platform', 'subscription')).toBe('Subscription $0.0034')
  })
  it('distinguishes estimates, authoritative totals and incomplete totals', () => {
    expect(formatCost(0.17)).toBe('≈ $0.17')
    expect(formatTotalCost({ costUsd: 0.0034, costKnown: 1, costActual: 1, records: 1 })).toBe('$0.0034')
    expect(formatTotalCost({ costUsd: 0.0034, costKnown: 1, costActual: 1, records: 2 })).toBe('≥ $0.0034')
    const result = replyStatParts({ durationMs: 1, models: { model: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: null, costSource: 'unavailable' } } })
    expect(result.parts.find(p => p.key === 'cost')).toMatchObject({ text: '—' })
  })
})
