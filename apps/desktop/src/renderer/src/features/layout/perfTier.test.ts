import { describe, expect, it } from 'vitest'
import { LAG_HOLD_MS, LAG_WINDOW_MS, noteLongFrame, perfTier } from './perfTier'

describe('perfTier', () => {
  it.each([
    [{ charging: true, lagUntil: 0, now: 1000 }, 'smooth', 'ac'],
    [{ charging: false, lagUntil: 0, now: 1000 }, 'saver', 'battery'],
    [{ charging: true, lagUntil: 2000, now: 1000 }, 'saver', 'lag'],
    [{ charging: false, lagUntil: 2000, now: 1000 }, 'saver', 'battery'],
    [{ charging: true, lagUntil: 1000, now: 1000 }, 'smooth', 'ac'],
  ] as const)('%o → %s（%s）', (input, tier, reason) => {
    expect(perfTier(input)).toEqual({ tier, reason })
  })
})

describe('noteLongFrame', () => {
  it('5 秒内凑够 3 次才降档，降到 30 秒后', () => {
    const frames: number[] = []
    let until = noteLongFrame(frames, 1000, 0)
    until = noteLongFrame(frames, 2000, until)
    expect(until).toBe(0)
    until = noteLongFrame(frames, 3000, until)
    expect(until).toBe(3000 + LAG_HOLD_MS)
    expect(frames).toEqual([])
  })

  it('隔得太开的长帧不凑数', () => {
    const frames: number[] = []
    let until = 0
    for (const at of [0, LAG_WINDOW_MS + 1, 2 * LAG_WINDOW_MS + 2]) until = noteLongFrame(frames, at, until)
    expect(until).toBe(0)
    expect(frames).toHaveLength(1)
  })

  it('降档期间再卡一次：恢复时间顺延', () => {
    expect(noteLongFrame([], 10_000, 20_000)).toBe(10_000 + LAG_HOLD_MS)
  })
})
