import { describe, expect, it } from 'vitest'
import { overlayHidesBrowser, type OverlayCandidate } from './browserOverlay'

const placeholder = { x: 800, y: 100, width: 400, height: 600 }
const popover = (x: number, y: number, width = 200, height = 150, modal = false): OverlayCandidate => ({
  rect: { x, y, width, height },
  modal,
})

describe('overlayHidesBrowser', () => {
  it('没有弹出层不藏', () => {
    expect(overlayHidesBrowser(placeholder, [])).toBe(false)
  })
  it('不重叠不藏', () => {
    expect(overlayHidesBrowser(placeholder, [popover(500, 600)])).toBe(false)
  })
  it('重叠就藏', () => {
    expect(overlayHidesBrowser(placeholder, [popover(700, 600)])).toBe(true)
  })
  it('余量内算重叠，余量外不算', () => {
    expect(overlayHidesBrowser(placeholder, [popover(598, 300)])).toBe(true)
    expect(overlayHidesBrowser(placeholder, [popover(590, 300)])).toBe(false)
  })
  it('模态一律藏，哪怕不重叠', () => {
    expect(overlayHidesBrowser(placeholder, [popover(0, 0, 100, 100, true)])).toBe(true)
  })
  it('零尺寸不算，模态也不算', () => {
    expect(overlayHidesBrowser(placeholder, [popover(900, 200, 0, 0)])).toBe(false)
    expect(overlayHidesBrowser(placeholder, [popover(900, 200, 0, 50, true)])).toBe(false)
  })
  it('多个里有一个重叠就藏', () => {
    expect(overlayHidesBrowser(placeholder, [popover(0, 0), popover(900, 200)])).toBe(true)
  })
})
