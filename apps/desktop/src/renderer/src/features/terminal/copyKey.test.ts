import { describe, expect, it } from 'vitest'
import { isCopyKey, isPasteKey, zoomKey } from './copyKey'
import { zoomedFontSize } from './prefs'

const key = (
  mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
  code = 'KeyC',
  printed = '',
) => ({
  code,
  key: printed,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
})

describe('isCopyKey', () => {
  it('Ctrl+Shift+C 不管有没有选中都是复制', () => {
    expect(isCopyKey(key({ ctrl: true, shift: true }), false, false)).toBe(true)
    expect(isCopyKey(key({ ctrl: true, shift: true }), true, false)).toBe(true)
    expect(isCopyKey(key({ meta: true, shift: true }), false, true)).toBe(true)
  })

  it('Windows / Linux：有选中时 Ctrl+C 复制，没选中时交给 Shell', () => {
    expect(isCopyKey(key({ ctrl: true }), true, false)).toBe(true)
    expect(isCopyKey(key({ ctrl: true }), false, false)).toBe(false)
  })

  it('macOS 的 Ctrl+C 永远是中断', () => {
    expect(isCopyKey(key({ ctrl: true }), true, true)).toBe(false)
  })

  it('别的组合不算', () => {
    expect(isCopyKey(key({ ctrl: true, alt: true }), true, false)).toBe(false)
    expect(isCopyKey(key({ ctrl: true, alt: true, shift: true }), true, false)).toBe(false)
    expect(isCopyKey(key({}), true, false)).toBe(false)
    expect(isCopyKey(key({ ctrl: true }, 'KeyV'), true, false)).toBe(false)
  })
})

describe('isPasteKey', () => {
  it('Windows / Linux：Ctrl+V 和 Ctrl+Shift+V 都是粘贴', () => {
    expect(isPasteKey(key({ ctrl: true }, 'KeyV'), false)).toBe(true)
    expect(isPasteKey(key({ ctrl: true, shift: true }, 'KeyV'), false)).toBe(true)
  })

  it('macOS：⌘+Shift+V 是粘贴，Ctrl+V 交给 Shell（⌘V 走浏览器的粘贴事件）', () => {
    expect(isPasteKey(key({ meta: true, shift: true }, 'KeyV'), true)).toBe(true)
    expect(isPasteKey(key({ ctrl: true }, 'KeyV'), true)).toBe(false)
    expect(isPasteKey(key({ meta: true }, 'KeyV'), true)).toBe(false)
  })

  it('别的组合不算', () => {
    expect(isPasteKey(key({ ctrl: true, alt: true }, 'KeyV'), false)).toBe(false)
    expect(isPasteKey(key({}, 'KeyV'), false)).toBe(false)
    expect(isPasteKey(key({ ctrl: true }), false)).toBe(false)
  })
})

describe('zoomKey / zoomedFontSize', () => {
  it('按印的字符认：+ 或 = 放大，- 缩小，0 恢复；小键盘也是这几个字符', () => {
    expect(zoomKey(key({ ctrl: true }, 'Equal', '='), false)).toBe(1)
    expect(zoomKey(key({ ctrl: true, shift: true }, 'Equal', '+'), false)).toBe(1)
    expect(zoomKey(key({ ctrl: true }, 'NumpadAdd', '+'), false)).toBe(1)
    expect(zoomKey(key({ ctrl: true }, 'Minus', '-'), false)).toBe(-1)
    expect(zoomKey(key({ ctrl: true }, 'NumpadSubtract', '-'), false)).toBe(-1)
    expect(zoomKey(key({ ctrl: true }, 'Digit0', '0'), false)).toBe(0)
  })

  it('德语键盘：- 在 Slash、+ 在 BracketRight 也认；位置是 Minus 的 ß 不算', () => {
    expect(zoomKey(key({ ctrl: true }, 'Slash', '-'), false)).toBe(-1)
    expect(zoomKey(key({ ctrl: true }, 'BracketRight', '+'), false)).toBe(1)
    expect(zoomKey(key({ ctrl: true }, 'Minus', 'ß'), false)).toBeNull()
  })

  it('macOS 用 ⌘，Ctrl 不算；别的组合不算', () => {
    expect(zoomKey(key({ meta: true }, 'Equal', '='), true)).toBe(1)
    expect(zoomKey(key({ ctrl: true }, 'Equal', '='), true)).toBeNull()
    expect(zoomKey(key({ ctrl: true, alt: true }, 'Equal', '='), false)).toBeNull()
    // 美式键盘 Ctrl+Shift+- 印的是 _
    expect(zoomKey(key({ ctrl: true, shift: true }, 'Minus', '_'), false)).toBeNull()
    expect(zoomKey(key({}, 'Equal', '='), false)).toBeNull()
    expect(zoomKey(key({ ctrl: true }, 'KeyA', 'a'), false)).toBeNull()
  })

  it('一次一号，不超出 8～32；小数字号先取整', () => {
    expect(zoomedFontSize(13, 1)).toBe(14)
    expect(zoomedFontSize(13.5, -1)).toBe(13)
    expect(zoomedFontSize(32, 1)).toBe(32)
    expect(zoomedFontSize(8, -1)).toBe(8)
  })
})
