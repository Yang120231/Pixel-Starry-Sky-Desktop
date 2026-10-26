import { describe, expect, it } from 'vitest'
import { formatBalance } from './account'

describe('余额文字', () => {
  it('USD 带 $，其他币种后缀币种代码', () => {
    expect(formatBalance(12.345, 'usd')).toBe('$12.35')
    expect(formatBalance(12.3, 'CNY')).toBe('12.30 CNY')
  })

  it('拿不到显示破折号，不足 0.01 显示 <，负数保留负号但 -0.001 不显示', () => {
    expect(formatBalance(null)).toBe('—')
    expect(formatBalance(Number.NaN)).toBe('—')
    expect(formatBalance(0.004)).toBe('<$0.01')
    expect(formatBalance(0.004, 'CNY')).toBe('<0.01 CNY')
    expect(formatBalance(-2)).toBe('-$2.00')
    expect(formatBalance(-0.001)).toBe('$0.00')
  })
})
