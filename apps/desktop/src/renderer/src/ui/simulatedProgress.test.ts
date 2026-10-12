import { describe, expect, it } from 'vitest'
import { median, simulated, SIMULATED_CAP } from './simulatedProgress'

describe('模拟进度', () => {
  it('从 0 开始，到预计用时约 83%，之后只逼近上限、不会走满', () => {
    expect(simulated(0, 30_000)).toBe(0)
    expect(simulated(30_000, 30_000)).toBeCloseTo(0.83, 2)
    expect(simulated(600_000, 30_000)).toBeLessThanOrEqual(SIMULATED_CAP)
    expect(simulated(600_000, 30_000)).toBeGreaterThan(0.91)
  })

  it('越走越慢，单调不减', () => {
    let last = 0
    for (let t = 1_000; t <= 120_000; t += 1_000) {
      const p = simulated(t, 30_000)
      expect(p).toBeGreaterThanOrEqual(last)
      last = p
    }
    expect(simulated(10_000, 30_000) - simulated(0, 30_000)).toBeGreaterThan(
      simulated(40_000, 30_000) - simulated(30_000, 30_000),
    )
  })

  it('预计用时无效时不动', () => {
    expect(simulated(5_000, 0)).toBe(0)
    expect(simulated(-5, 30_000)).toBe(0)
  })

  it('中位数', () => {
    expect(median([])).toBeNull()
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([NaN, 5])).toBe(5)
  })
})
