import { describe, expect, it } from 'vitest'
import { estimateCost, officialPrice } from '.'

describe('按官方模型定价估算（docs/ui/custom-api.md §4.3）', () => {
  it('精确对、去掉前缀和后缀对、计价参照、对不上', () => {
    expect(officialPrice('claude-sonnet-4-5')).toMatchObject({ vendor: 'anthropic', input: 3, output: 15 })
    expect(officialPrice('anthropic/claude-sonnet-4-5-20250929')?.model).toBe('claude-sonnet-4-5')
    expect(officialPrice('claude-sonnet-4-5-20250929')?.model).toBe('claude-sonnet-4-5-20250929')
    expect(officialPrice('claude-sonnet-4-5-thinking')?.model).toBe('claude-sonnet-4-5')
    expect(officialPrice('claude-sonnet-4-5[1m]')?.model).toBe('claude-sonnet-4-5')
    expect(officialPrice('openai/gpt-5')?.model).toBe('gpt-5')
    expect(officialPrice('deepseek-chat')).toBeNull()
    expect(officialPrice('deepseek-chat', 'gpt-5')?.model).toBe('gpt-5')
    expect(officialPrice('toString')).toBeNull()
  })
  it('按 token 乘单价', () => {
    const p = officialPrice('claude-sonnet-4-5')
    expect(estimateCost({ input: 1_000_000, output: 100_000, cacheRead: 1_000_000, cacheWrite: 0 }, p)).toBeCloseTo(
      3 + 1.5 + 0.3,
    )
    expect(estimateCost({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, null)).toBeNull()
  })
})
