import { describe, expect, it } from 'vitest'
import { latestSlot, nextSlot } from './schedule'

// 本地时间：2026-10-26 是周一
const at = (day: number, h: number, m = 0): number => new Date(2026, 9, day, h, m).getTime()
const daily = { freq: 'daily', hour: 9, minute: 0, weekday: 1 } as const

describe('latestSlot / nextSlot', () => {
  it('每天：当天没到点取昨天，到点取今天', () => {
    expect(latestSlot(daily, at(26, 8, 59))).toBe(at(25, 9))
    expect(latestSlot(daily, at(26, 9))).toBe(at(26, 9))
    expect(nextSlot(daily, at(26, 9))).toBe(at(27, 9))
    expect(nextSlot(daily, at(26, 8))).toBe(at(26, 9))
  })
  it('工作日：周末跳过', () => {
    const s = { ...daily, freq: 'weekdays' } as const
    expect(latestSlot(s, at(25, 12))).toBe(at(23, 9)) // 周日 → 周五
    expect(nextSlot(s, at(23, 10))).toBe(at(26, 9)) // 周五 → 周一
  })
  it('每周：只在选定的星期几', () => {
    const s = { ...daily, freq: 'weekly', weekday: 1 } as const
    expect(latestSlot(s, at(28, 12))).toBe(at(26, 9))
    expect(nextSlot(s, at(26, 10))).toBe(new Date(2026, 10, 2, 9).getTime()) // 11-02 周一
  })
  it('每小时：用分钟', () => {
    const s = { freq: 'hourly', hour: 0, minute: 30, weekday: 0 } as const
    expect(latestSlot(s, at(26, 10, 29))).toBe(at(26, 9, 30))
    expect(latestSlot(s, at(26, 10, 30))).toBe(at(26, 10, 30))
    expect(nextSlot(s, at(26, 10, 30))).toBe(at(26, 11, 30))
  })
})
