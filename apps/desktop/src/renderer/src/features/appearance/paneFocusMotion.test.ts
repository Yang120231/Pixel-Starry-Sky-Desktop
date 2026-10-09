import { afterEach, describe, expect, it, vi } from 'vitest'
import { PANE_FOCUS_MOTION_KEY, parsePaneFocusMotion, readPaneFocusMotion } from './paneFocusMotion'
import { searchSettings } from '../settings/searchIndex'

afterEach(() => vi.unstubAllGlobals())

describe('窗格焦点动画偏好', () => {
  it('缺失、旧值或损坏类型回到高亮，三档有效值完整保留', () => {
    for (const value of [undefined, null, '', 'blink', {}, 1]) expect(parsePaneFocusMotion(value)).toBe('flash')
    for (const value of ['flash', 'slide', 'none']) expect(parsePaneFocusMotion(value)).toBe(value)
  })
  it('读取独立的本机设置键，存储不可用时仍可以启动', () => {
    const getItem = vi.fn((key: string) => (key === PANE_FOCUS_MOTION_KEY ? 'slide' : null))
    vi.stubGlobal('localStorage', { getItem })
    expect(readPaneFocusMotion()).toBe('slide')
    expect(getItem).toHaveBeenCalledWith('pixelsky.paneFocusMotion')
    getItem.mockImplementation(() => {
      throw new Error('Storage unavailable')
    })
    expect(readPaneFocusMotion()).toBe('flash')
  })
  it('用高亮、窗格或滑动搜索设置时都能找到切换选项', () => {
    for (const query of ['高亮', '窗格', '滑动']) {
      expect(searchSettings(query, s => s).some(e => e.section === 'appearance' && e.title === '切换窗格时')).toBe(true)
    }
  })
})
