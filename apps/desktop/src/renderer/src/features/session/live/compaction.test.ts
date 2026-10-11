import { describe, expect, it } from 'vitest'
import { compactionClock, compactionRatio, compactionSaved, easeTokens } from './compaction'

describe('压缩上下文的数字', () => {
  it('计时：分:秒，超过一小时带小时', () => {
    expect(compactionClock(0)).toBe('0:00')
    expect(compactionClock(7_900)).toBe('0:07')
    expect(compactionClock(102_000)).toBe('1:42')
    expect(compactionClock(3_725_000)).toBe('1:02:05')
    expect(compactionClock(-5)).toBe('0:00')
  })

  it('比例和减少的百分比：两头都知道才有；没变小不算减少', () => {
    expect(compactionRatio({ preTokens: 200_000, postTokens: 20_000 })).toBe(0.1)
    expect(compactionRatio({ preTokens: 200_000, postTokens: 100 })).toBe(0.02)
    expect(compactionRatio({ preTokens: 200_000, postTokens: null })).toBeNull()
    expect(compactionRatio({ preTokens: 0, postTokens: 0 })).toBeNull()
    expect(compactionSaved({ preTokens: 184_213, postTokens: 12_480 })).toBe(93)
    expect(compactionSaved({ preTokens: 10_000, postTokens: 12_000 })).toBeNull()
    expect(compactionSaved({ preTokens: null, postTokens: 12_000 })).toBeNull()
  })

  it('递减动画：从压缩前缓动到压缩后', () => {
    expect(easeTokens(100_000, 10_000, 0)).toBe(100_000)
    expect(easeTokens(100_000, 10_000, 1)).toBe(10_000)
    expect(easeTokens(100_000, 10_000, 2)).toBe(10_000)
    expect(easeTokens(100_000, 10_000, 0.5)).toBeLessThan(55_000)
  })
})
