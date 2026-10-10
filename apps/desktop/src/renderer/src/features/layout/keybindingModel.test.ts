// 自定义快捷键的组合键（docs/ui/custom-shortcuts.md）
import { describe, expect, it } from 'vitest'
import {
  bindingFromEvent,
  bindingProblem,
  formatBinding,
  matchesBinding,
  parseBinding,
  type KeyEventLike,
} from './keybindingModel'

const ev = (code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  code,
  key: 'Process',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
})

describe('组合键', () => {
  it('显示文字：Windows 用 Ctrl+…，macOS 用符号', () => {
    const b = { code: 'KeyD', mod: true, shift: true, alt: false }
    expect(formatBinding(b, false)).toBe('Ctrl+Shift+D')
    expect(formatBinding(b, true)).toBe('⇧⌘D')
    expect(formatBinding({ code: 'KeyB', mod: true, shift: false, alt: true }, false)).toBe('Ctrl+Alt+B')
    expect(formatBinding({ code: 'KeyB', mod: true, shift: false, alt: true }, true)).toBe('⌥⌘B')
    expect(formatBinding({ code: 'Backquote', mod: true, shift: false, alt: false }, false)).toBe('Ctrl+`')
    expect(formatBinding({ code: 'Enter', mod: true, shift: true, alt: false }, true)).toBe('⇧⌘↩')
    expect(formatBinding({ code: 'F5', mod: false, shift: false, alt: false }, false)).toBe('F5')
  })

  it('从按键事件生成：用按键位置（中文输入法开着时 key 是 Process），只按修饰键不算', () => {
    expect(bindingFromEvent(ev('KeyE', { ctrlKey: true, shiftKey: true }), false)).toEqual({
      code: 'KeyE',
      mod: true,
      shift: true,
      alt: false,
    })
    expect(bindingFromEvent(ev('KeyE', { metaKey: true }), true)?.mod).toBe(true)
    expect(bindingFromEvent(ev('KeyE', { ctrlKey: true }), true)?.mod).toBe(false)
    expect(bindingFromEvent(ev('ShiftLeft', { shiftKey: true }), false)).toBeNull()
    expect(bindingFromEvent(ev('ControlRight', { ctrlKey: true }), false)).toBeNull()
  })

  it('判断按键：修饰键要完全一致，另一个平台的修饰键按着不算，小键盘回车算回车', () => {
    const b = { code: 'KeyB', mod: true, shift: false, alt: false }
    expect(matchesBinding(ev('KeyB', { ctrlKey: true }), b, false)).toBe(true)
    expect(matchesBinding(ev('KeyB', { ctrlKey: true, shiftKey: true }), b, false)).toBe(false)
    expect(matchesBinding(ev('KeyB', { ctrlKey: true, metaKey: true }), b, false)).toBe(false)
    expect(matchesBinding(ev('KeyB', { metaKey: true }), b, true)).toBe(true)
    expect(matchesBinding(ev('KeyB', { metaKey: true, ctrlKey: true }), b, true)).toBe(false)
    const zoom = { code: 'Enter', mod: true, shift: true, alt: false }
    expect(matchesBinding(ev('NumpadEnter', { ctrlKey: true, shiftKey: true }), zoom, false)).toBe(true)
  })

  it('检查：要带 Ctrl / Alt 或用 F 键，不收复制粘贴等编辑组合', () => {
    expect(bindingProblem({ code: 'KeyE', mod: false, shift: true, alt: false })).toBe('modifier')
    expect(bindingProblem({ code: 'F2', mod: false, shift: false, alt: false })).toBeNull()
    expect(bindingProblem({ code: 'KeyE', mod: false, shift: false, alt: true })).toBeNull()
    expect(bindingProblem({ code: 'KeyC', mod: true, shift: false, alt: false })).toBe('reserved')
    expect(bindingProblem({ code: 'KeyV', mod: true, shift: true, alt: false })).toBe('reserved')
    expect(bindingProblem({ code: 'KeyE', mod: true, shift: true, alt: false })).toBeNull()
  })

  it('读本机保存的：形状不对当作没改', () => {
    expect(parseBinding({ code: 'KeyE', mod: true })).toEqual({ code: 'KeyE', mod: true, shift: false, alt: false })
    expect(parseBinding({ mod: true })).toBeNull()
    expect(parseBinding('Ctrl+E')).toBeNull()
  })
})

describe('默认快捷键', () => {
  it('互相不重复，也不和固定的、编辑组合撞', async () => {
    const { ACTIONS, FIXED } = await import('./keybindings')
    const { sameBinding } = await import('./keybindingModel')
    const all = ACTIONS.map(a => a.binding)
    all.forEach((b, i) => {
      expect(
        all.findIndex(o => sameBinding(o, b)),
        ACTIONS[i].id,
      ).toBe(i)
      expect(bindingProblem(b), ACTIONS[i].id).toBeNull()
      expect(
        FIXED.some(f => f.bindings.some(o => sameBinding(o, b))),
        ACTIONS[i].id,
      ).toBe(false)
    })
  })
})
