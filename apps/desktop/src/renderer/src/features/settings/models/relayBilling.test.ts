import { describe, expect, it } from 'vitest'
import { multiplierText, newApiSuggestion } from './relayBilling'

const base = {
  kind: 'new-api' as const,
  site: null,
  groups: [
    { name: 'vip', label: 'VIP', ratio: 0.5 },
    { name: 'default', label: '默认', ratio: 1 },
  ],
  models: [
    { id: 'deepseek-chat', factor: null },
    { id: 'claude-sonnet-4-5', factor: 1.2 },
  ],
  recharge: 0.5,
}

describe('new-api 的建议倍率', () => {
  it('分组倍率 × 第一个对得上官方价的模型的倍数 × 充值折扣，保留三位', () => {
    expect(newApiSuggestion(base, 'vip')).toBe(0.3)
    expect(newApiSuggestion({ ...base, recharge: null }, 'default')).toBe(1.2)
    expect(newApiSuggestion({ ...base, recharge: 1 / 3 }, 'default')).toBe(0.4)
  })

  it('选的分组不在、没有对得上的模型、超出范围：算不出', () => {
    expect(newApiSuggestion(base, 'nope')).toBeNull()
    expect(newApiSuggestion({ ...base, models: [{ id: 'x', factor: null }] }, 'vip')).toBeNull()
    expect(newApiSuggestion({ ...base, groups: [{ name: 'g', label: 'g', ratio: 100 }], recharge: 1 }, 'g')).toBeNull()
  })

  it('写进输入框去掉多余的 0', () => {
    expect(multiplierText(0.6)).toBe('0.6')
    expect(multiplierText(0.34246575)).toBe('0.342')
  })
})
