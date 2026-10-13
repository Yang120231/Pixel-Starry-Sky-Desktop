import { describe, expect, it, vi } from 'vitest'
import { pathClickHandlers } from './pathClick'

const mouse = (detail: number) => ({ detail, preventDefault: vi.fn() })
const key = (k: string, shiftKey = false) => ({ key: k, shiftKey, preventDefault: vi.fn() })

function setup(withReveal = true) {
  const open = vi.fn()
  const reveal = vi.fn()
  return { open, reveal, h: pathClickHandlers({ open, reveal: withReveal ? reveal : null }) }
}

describe('pathClickHandlers', () => {
  it('单击打开，键盘触发的 click（detail 0）也算', () => {
    const { h, open } = setup()
    h.onClick(mouse(1))
    h.onClick(mouse(0))
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('双击的第二下点击不重复打开，由 onDoubleClick 在文件夹中显示', () => {
    const { h, open, reveal } = setup()
    h.onClick(mouse(1))
    h.onClick(mouse(2))
    h.onDoubleClick(mouse(2))
    expect(open).toHaveBeenCalledTimes(1)
    expect(reveal).toHaveBeenCalledTimes(1)
  })

  it('Enter 打开，Shift+Enter 在文件夹中显示，其它键不管', () => {
    const { h, open, reveal } = setup()
    const plain = key('Enter')
    h.onKeyDown(plain)
    expect(open).toHaveBeenCalledTimes(1)
    expect(plain.preventDefault).toHaveBeenCalled()
    expect(reveal).not.toHaveBeenCalled()
    const shifted = key('Enter', true)
    h.onKeyDown(shifted)
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(shifted.preventDefault).toHaveBeenCalled()
    h.onKeyDown(key('a'))
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('双击不选中文字，单击保持默认行为', () => {
    const { h } = setup()
    const single = mouse(1)
    const double = mouse(2)
    h.onMouseDown(single)
    h.onMouseDown(double)
    expect(single.preventDefault).not.toHaveBeenCalled()
    expect(double.preventDefault).toHaveBeenCalled()
  })

  it('没有 reveal 时双击和 Shift+Enter 什么都不做', () => {
    const { h, open } = setup(false)
    h.onDoubleClick(mouse(2))
    const shifted = key('Enter', true)
    h.onKeyDown(shifted)
    expect(open).not.toHaveBeenCalled()
    // 也不能落到浏览器原生的 click 上
    expect(shifted.preventDefault).toHaveBeenCalled()
  })
})
