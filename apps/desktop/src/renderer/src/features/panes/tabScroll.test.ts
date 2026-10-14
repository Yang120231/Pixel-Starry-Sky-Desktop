// 会话标签栏的滚动（GitHub #16）
import { describe, expect, it } from 'vitest'
import {
  easeStep,
  isWheelNotch,
  overflowEdges,
  pageTarget,
  revealTarget,
  shouldReveal,
  wheelDistance,
} from './tabScroll'

const wheel = (deltaY: number, extra: Partial<Parameters<typeof wheelDistance>[0]> = {}) => ({
  deltaX: 0,
  deltaY,
  deltaMode: 0,
  shiftKey: false,
  ...extra,
})

describe('滚轮', () => {
  it('竖直滚轮换成横向距离：像素、行、页三种单位', () => {
    expect(wheelDistance(wheel(100), 600)).toBe(100)
    expect(wheelDistance(wheel(-3, { deltaMode: 1 }), 600)).toBe(-48)
    expect(wheelDistance(wheel(1, { deltaMode: 2 }), 600)).toBe(600)
  })

  it('横向为主的手势、Shift + 滚轮、没有竖直分量：不接管，交给浏览器', () => {
    expect(wheelDistance(wheel(10, { deltaX: 30 }), 600)).toBeNull()
    expect(wheelDistance(wheel(100, { shiftKey: true }), 600)).toBeNull()
    expect(wheelDistance(wheel(0), 600)).toBeNull()
  })

  it('鼠标滚轮一格（大步、按行）缓动，触控板的小步直接跟手', () => {
    expect(isWheelNotch(wheel(100))).toBe(true)
    expect(isWheelNotch(wheel(-120))).toBe(true)
    expect(isWheelNotch(wheel(3, { deltaMode: 1 }))).toBe(true)
    expect(isWheelNotch(wheel(4.5))).toBe(false)
  })
})

describe('当前标签滚进可视区', () => {
  const view = { scrollLeft: 200, clientWidth: 400, scrollWidth: 2000 }

  it('完整可见（含两边留白）时不动', () => {
    expect(revealTarget(view, { left: 300, width: 150 }, 28)).toBeNull()
  })

  it('在左边外面：滚到它左边留出空白；在右边外面：滚到它右边留出空白', () => {
    expect(revealTarget(view, { left: 100, width: 150 }, 28)).toBe(72)
    expect(revealTarget(view, { left: 700, width: 150 }, 28)).toBe(700 + 150 + 28 - 400)
  })

  it('不超出能滚的范围；比可视区还宽时露出开头', () => {
    expect(revealTarget(view, { left: 10, width: 100 }, 28)).toBe(0)
    expect(revealTarget(view, { left: 1900, width: 90 }, 28)).toBe(1600)
    expect(revealTarget(view, { left: 900, width: 500 }, 28)).toBe(872)
  })

  it('当前标签换了、多了标签才滚；只是关掉别的标签不滚（不把正在翻的标签栏拉回去）', () => {
    const before = { active: 'b', tabs: new Set(['a', 'b', 'c']) }
    expect(shouldReveal(before, 'c', ['a', 'b', 'c'])).toBe(true)
    expect(shouldReveal(before, 'b', ['a', 'b', 'c', 'd'])).toBe(true)
    expect(shouldReveal(before, 'b', ['a', 'b'])).toBe(false)
    expect(shouldReveal(before, 'b', ['b', 'a', 'c'])).toBe(false)
  })

  it('两头有没露出来的标签才淡出', () => {
    expect(overflowEdges({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400 })).toEqual({ left: false, right: false })
    expect(overflowEdges({ scrollLeft: 0, clientWidth: 400, scrollWidth: 900 })).toEqual({ left: false, right: true })
    expect(overflowEdges({ scrollLeft: 250, clientWidth: 400, scrollWidth: 900 })).toEqual({ left: true, right: true })
    expect(overflowEdges({ scrollLeft: 500, clientWidth: 400, scrollWidth: 900 })).toEqual({ left: true, right: false })
  })
})

describe('缓动', () => {
  it('每帧走一部分，最后一定到位（只差一两像素时也会收尾，不会一直转）', () => {
    let pos = 2
    let frames = 0
    while (pos !== 0 && frames < 100) {
      pos = easeStep(pos, 0)
      frames++
    }
    expect(pos).toBe(0)
    expect(frames).toBeLessThan(20)
    expect(easeStep(0, 100)).toBeCloseTo(22)
  })
})

describe('箭头翻页', () => {
  const v = { scrollLeft: 100, clientWidth: 400, scrollWidth: 1000 }
  it('翻 80% 可视宽度，夹在可滚范围内', () => {
    expect(pageTarget(v, 1)).toBe(420)
    expect(pageTarget(v, -1)).toBe(0)
    expect(pageTarget({ ...v, scrollLeft: 500 }, 1)).toBe(600)
  })
  it('可视区很窄时至少翻 80px，从给定起点接着走', () => {
    expect(pageTarget({ scrollLeft: 0, clientWidth: 50, scrollWidth: 1000 }, 1)).toBe(80)
    expect(pageTarget(v, 1, 420)).toBe(600)
  })
})
