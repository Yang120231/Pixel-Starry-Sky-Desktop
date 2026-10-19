import { describe, expect, it } from 'vitest'
import type { AccountInfo } from '../../../../../shared/types/account'
import { platformPlanLimits, platformQuota, windowMinutes } from './platformQuota'
import { quotaButtonView, quotaLayout } from './quotaModel'

const NOW = new Date(2026, 9, 19, 14, 32).getTime()

const account = (over: Partial<AccountInfo> = {}): AccountInfo => ({
  email: 'linxia@example.com',
  name: '林夏',
  balance: 12.34,
  currency: 'USD',
  group: { name: 'pixelsky-pro', billingSource: 'subscription' },
  plan: {
    name: 'Pro 月卡',
    expiresAt: null,
    daily: { used: 1.2, limit: 10 },
    weekly: { used: 46.5, limit: 50 },
    monthly: { used: 3, limit: 0 },
  },
  rateLimits: [{ window: '5h', used: 0.5, limit: 2 }],
  updatedAt: NOW - 2 * 60_000,
  ...over,
})

describe('platformQuota：AccountInfo → AccountQuota', () => {
  it('窗口换算成分钟：5h / 1d / 7d', () => {
    expect(windowMinutes('5h')).toBe(300)
    expect(windowMinutes('1d')).toBe(1_440)
    expect(windowMinutes('7d')).toBe(10_080)
    expect(windowMinutes('7 D')).toBe(10_080)
    expect(windowMinutes('forever')).toBeNull()
  })
  it('已用百分比、金额、没有恢复时间', () => {
    const q = platformQuota(
      account({
        rateLimits: [
          { window: '5h', used: 0.5, limit: 2 },
          { window: '1d', used: 3, limit: 10 },
          { window: '7d', used: 50, limit: 40 },
        ],
      }),
    )!
    expect(q.provider).toBe('platform')
    expect(q.windows.map(w => [w.id, w.durationMins, w.usedPercent, w.resetsAt])).toEqual([
      ['five_hour', 300, 25, null],
      ['mins:1440', 1_440, 30, null],
      ['seven_day', 10_080, 100, null],
    ])
    expect(q.windows[0].money).toEqual({ used: 0.5, limit: 2, currency: 'USD' })
  })
  it('limit 为 0（不限）的窗口跳过', () => {
    const q = platformQuota(
      account({
        rateLimits: [
          { window: '5h', used: 9, limit: 0 },
          { window: '7d', used: 1, limit: 4 },
        ],
      }),
    )!
    expect(q.windows.map(w => w.id)).toEqual(['seven_day'])
  })
  it('余额、套餐名、账号、时间', () => {
    const q = platformQuota(account())!
    expect(q).toMatchObject({
      status: 'ok',
      plan: 'Pro 月卡',
      account: '林夏',
      extras: { balance: { amount: 12.34, currency: 'USD' } },
      observedAt: NOW - 2 * 60_000,
      fetchedAt: NOW - 2 * 60_000,
      refreshable: true,
      source: 'usage',
    })
  })
  it('余额拿不到是 null；没登录是 null；没有任何数据是 empty', () => {
    expect(platformQuota(account({ balance: null }))!.extras.balance).toBeNull()
    expect(platformQuota(null)).toBeNull()
    expect(platformQuota(account({ rateLimits: [], balance: null }))!.status).toBe('empty')
  })
  it('只按余额计费、没有窗口：没有窗口可画', () => {
    expect(platformQuota(account({ rateLimits: [] }))!.windows).toEqual([])
  })
  it('按钮「5h 25%」', () => {
    const v = quotaButtonView(platformQuota(account()), { provider: 'platform', loading: false, now: NOW })
    expect([v.short, v.value]).toEqual(['5h', '25%'])
    expect(v.label).toBe('像素星空账号额度：5 小时内已用 25%')
  })
})

describe('平台套餐额度', () => {
  it('limit 大于 0 的才算，进「其它」小列表', () => {
    const limits = platformPlanLimits(account())
    expect(limits.map(l => l.id)).toEqual(['daily', 'weekly'])
    const q = platformQuota(account())!
    const layout = quotaLayout(q, { provider: 'platform', now: NOW, balanceText: '$12.34', planLimits: limits })
    expect(layout.rows.map(r => [r.name, r.value, r.level])).toEqual([
      ['套餐 · 每天', '$1.20 / $10.00', 'normal'],
      ['套餐 · 每周', '$46.50 / $50.00', 'warn'],
    ])
  })
  it('没有套餐', () => {
    expect(platformPlanLimits(account({ plan: null }))).toEqual([])
    expect(platformPlanLimits(null)).toEqual([])
  })
})
