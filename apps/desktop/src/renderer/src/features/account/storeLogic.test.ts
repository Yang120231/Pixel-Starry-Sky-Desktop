import { describe, expect, it } from 'vitest'
import type { StoreRecharge } from '../../../../shared/types/account'
import { checkAmount, isCurrentPlan, matchTier, quoteRecharge, round2, validityLabel } from './storeLogic'

const recharge = (over: Partial<StoreRecharge> = {}): StoreRecharge => ({
  enabled: true,
  min: 5,
  max: 500,
  multiplier: 1.5,
  feeRate: 2,
  bonusMode: 'bonus',
  bonusTiers: [
    { minAmount: 100, bonusPercent: 5 },
    { minAmount: 500, bonusPercent: 10 },
  ],
  usdToCnyRate: 7.2,
  ...over,
})

describe('validityLabel', () => {
  it('只有正好 30 / 90 / 365 天才显示月 / 季 / 年', () => {
    expect(validityLabel(30)).toBe('月')
    expect(validityLabel(90)).toBe('季')
    expect(validityLabel(365)).toBe('年')
  })
  it('其余按天', () => {
    expect(validityLabel(7)).toBe('7 天')
    expect(validityLabel(31)).toBe('31 天')
    expect(validityLabel(1)).toBe('1 天')
  })
})

describe('isCurrentPlan', () => {
  it('账号的 plan.name 是分组名：按分组名匹配，也认套餐名', () => {
    expect(isCurrentPlan({ name: 'Claude 周卡', groupName: 'Claude Sub' }, 'Claude Sub')).toBe(true)
    expect(isCurrentPlan({ name: 'Claude 周卡', groupName: 'Claude Sub' }, 'Claude 周卡')).toBe(true)
    expect(isCurrentPlan({ name: 'GPT 周卡', groupName: 'GPT Pro' }, 'Claude Sub')).toBe(false)
    expect(isCurrentPlan({ name: 'x', groupName: '' }, null)).toBe(false)
  })
})

describe('matchTier', () => {
  it('取不超过金额的最大档位', () => {
    const tiers = recharge().bonusTiers
    expect(matchTier(tiers, 99.99)).toBeNull()
    expect(matchTier(tiers, 100)?.bonusPercent).toBe(5)
    expect(matchTier(tiers, 499)?.bonusPercent).toBe(5)
    expect(matchTier(tiers, 500)?.bonusPercent).toBe(10)
  })
})

describe('quoteRecharge', () => {
  it('没命中档位：到账 = 金额 × 倍率，应付 = 金额 + 手续费', () => {
    expect(quoteRecharge(recharge(), 50)).toEqual({ credited: 75, bonus: 0, payBase: 50, fee: 1, pay: 51, percent: 0 })
  })
  it('赠金模式：在到账基数上多送百分比，实付不变', () => {
    // 100 × 1.5 = 150；送 5% = 7.5；到账 157.5；手续费 2
    expect(quoteRecharge(recharge(), 100)).toEqual({
      credited: 157.5,
      bonus: 7.5,
      payBase: 100,
      fee: 2,
      pay: 102,
      percent: 5,
    })
  })
  it('折扣模式：到账不变，实付基数打折，免费部分 = 到账 − 实付部分的到账', () => {
    const q = quoteRecharge(recharge({ bonusMode: 'discount' }), 100)
    // 实付基数 95；手续费 1.9；到账 150；免费 150 − round2(95 × 1.5 = 142.5) = 7.5
    expect(q).toEqual({ credited: 150, bonus: 7.5, payBase: 95, fee: 1.9, pay: 96.9, percent: 5 })
  })
  it('手续费向上取整到分', () => {
    // 3.33 × 2% = 0.0666 → 0.07
    expect(quoteRecharge(recharge({ multiplier: 1 }), 3.33).fee).toBe(0.07)
  })
  it('折扣百分比 >= 100 的非法档位按无优惠处理', () => {
    const q = quoteRecharge(recharge({ bonusMode: 'discount', bonusTiers: [{ minAmount: 1, bonusPercent: 100 }] }), 10)
    expect(q.percent).toBe(0)
    expect(q.payBase).toBe(10)
  })
  it('十进制舍入', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(2.675)).toBe(2.68)
  })
})

describe('checkAmount', () => {
  const r = { min: 5, max: 500 }
  it('空、格式、范围', () => {
    expect(checkAmount('', r)).toEqual({ ok: false, reason: 'empty' })
    expect(checkAmount('1.234', r)).toEqual({ ok: false, reason: 'format' })
    expect(checkAmount('abc', r)).toEqual({ ok: false, reason: 'format' })
    expect(checkAmount('4.99', r)).toEqual({ ok: false, reason: 'min' })
    expect(checkAmount('500.01', r)).toEqual({ ok: false, reason: 'max' })
    expect(checkAmount('5', r)).toEqual({ ok: true, value: 5 })
  })
  it('max 为 0 表示不限', () => {
    expect(checkAmount('99999', { min: 0, max: 0 })).toEqual({ ok: true, value: 99999 })
  })
})
