import { describe, expect, it } from 'vitest'
import { centerShift } from './windowCenter'

describe('centerShift', () => {
  it('单窗格贴着窗口右边：窗口中线减窗格中线', () => {
    expect(centerShift({ left: 290, right: 1440 }, { left: 290, right: 1440 }, 1440)).toBe(-145)
    expect(centerShift({ left: 0, right: 1440 }, { left: 0, right: 1440 }, 1440)).toBe(0)
  })
  it('右侧面板开着、分屏、找不到窗格区域时不挪', () => {
    expect(centerShift({ left: 290, right: 970 }, { left: 290, right: 970 }, 1440)).toBe(0)
    expect(centerShift({ left: 865, right: 1440 }, { left: 290, right: 1440 }, 1440)).toBe(0)
    expect(centerShift({ left: 290, right: 1440 }, null, 1440)).toBe(0)
  })
})
