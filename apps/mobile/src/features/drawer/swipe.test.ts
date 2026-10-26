import { describe, expect, it } from 'vitest'
import { ACTIONS_W, dragOffset, lockAxis, settlesOpen } from './swipe'

describe('会话行左滑', () => {
  it('动了 10px 以上才定方向，横向比竖向多才算左滑', () => {
    expect(lockAxis(5, 8)).toBeNull()
    expect(lockAxis(-12, 4)).toBe('h')
    expect(lockAxis(-12, 20)).toBe('v')
    expect(lockAxis(4, 12)).toBe('v')
    expect(lockAxis(-11, 11)).toBe('v')
  })

  it('偏移限制在操作区宽度内；开着的行往右拖就收回', () => {
    expect(dragOffset(0, -40)).toBe(-40)
    expect(dragOffset(0, -300)).toBe(-ACTIONS_W)
    expect(dragOffset(0, 30)).toBe(0)
    expect(dragOffset(-ACTIONS_W, 100)).toBe(-50)
  })

  it('松手：拖过一半停在打开，否则收回', () => {
    expect(settlesOpen(-80)).toBe(true)
    expect(settlesOpen(-ACTIONS_W / 2)).toBe(true)
    expect(settlesOpen(-60)).toBe(false)
    expect(settlesOpen(0)).toBe(false)
  })
})
