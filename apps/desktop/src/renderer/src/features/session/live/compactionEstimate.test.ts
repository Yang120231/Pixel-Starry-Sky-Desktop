import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMPACTION_MS,
  DEFAULT_COMPACTION_RATIO,
  DEFAULT_FIRST_TOKEN_MS,
  DEFAULT_SUMMARY_TOKENS,
  expectedDuration,
  expectedFirstToken,
  expectedOutput,
  expectedRatio,
  type CompactionSample,
} from './compactionEstimate'

const sample = (id: string, preTokens: number, durationMs: number, ratio: number): CompactionSample => ({
  id,
  preTokens,
  durationMs,
  ratio,
})

describe('压缩的预计用时和比例', () => {
  it('没有记录时用默认值', () => {
    expect(expectedDuration(180_000, [])).toBe(DEFAULT_COMPACTION_MS)
    expect(expectedDuration(null, [])).toBe(DEFAULT_COMPACTION_MS)
    expect(expectedRatio([])).toBe(DEFAULT_COMPACTION_RATIO)
  })

  it('按每 1k token 的用时中位数换算到这次的大小', () => {
    const samples = [
      sample('a', 100_000, 20_000, 0.1),
      sample('b', 200_000, 40_000, 0.05),
      sample('c', 100_000, 90_000, 0.2), // 偶尔一次很慢，不该把预计拉高太多
    ]
    expect(expectedDuration(300_000, samples)).toBe(60_000)
    expect(expectedRatio(samples)).toBe(0.1)
  })

  it('不知道这次多大时用用时中位数；很小的上下文至少 3 秒', () => {
    const samples = [sample('a', 100_000, 20_000, 0.1), sample('b', 100_000, 30_000, 0.1)]
    expect(expectedDuration(null, samples)).toBe(25_000)
    expect(expectedDuration(1_000, samples)).toBe(3_000)
  })
})

describe('平时的摘要长度和首字用时', () => {
  it('只按带这两项的记录（经过网关的）算；没有时用默认值', () => {
    const plain = sample('a', 100_000, 20_000, 0.1)
    expect(expectedOutput([plain])).toBe(DEFAULT_SUMMARY_TOKENS)
    expect(expectedFirstToken([plain])).toBe(DEFAULT_FIRST_TOKEN_MS)
    const samples = [
      plain,
      { ...sample('b', 100_000, 20_000, 0.1), firstTokenMs: 6_000, outputTokens: 1_500 },
      { ...sample('c', 100_000, 20_000, 0.1), firstTokenMs: 8_000, outputTokens: 2_500 },
    ]
    expect(expectedOutput(samples)).toBe(2_000)
    expect(expectedFirstToken(samples)).toBe(7_000)
  })
})
