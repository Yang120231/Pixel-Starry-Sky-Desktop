import { describe, expect, it } from 'vitest'
import { DEFAULT_INTERVAL_MS, nextInterval } from './samplerInterval'

describe('采样间隔', () => {
  it('按主进程回复的间隔', () => {
    expect(nextInterval({ intervalMs: 10_000 })).toBe(10_000)
  })
  it('回复不合理用默认，过小过大夹住', () => {
    expect(nextInterval(undefined)).toBe(DEFAULT_INTERVAL_MS)
    expect(nextInterval({ intervalMs: 'x' })).toBe(DEFAULT_INTERVAL_MS)
    expect(nextInterval({ intervalMs: NaN })).toBe(DEFAULT_INTERVAL_MS)
    expect(nextInterval({ intervalMs: 10 })).toBe(5_000)
    expect(nextInterval({ intervalMs: 1e9 })).toBe(600_000)
  })
})
