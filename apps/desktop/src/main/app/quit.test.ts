import { describe, expect, it } from 'vitest'
import { quitWhenAllClosed } from './quit'

describe('窗口全关后', () => {
  it('Windows / Linux 退出', () => {
    expect(quitWhenAllClosed('win32', false)).toBe(true)
    expect(quitWhenAllClosed('linux', false)).toBe(true)
  })
  it('macOS 平时不退出，正在走退出流程（菜单、托盘、崩溃对话框的「退出」）时退出', () => {
    expect(quitWhenAllClosed('darwin', false)).toBe(false)
    expect(quitWhenAllClosed('darwin', true)).toBe(true)
  })
})
