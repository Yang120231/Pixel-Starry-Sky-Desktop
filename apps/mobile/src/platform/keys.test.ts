import { describe, expect, it } from 'vitest'
import { shortcutOf, type KeyLike } from './keys'

const key = (k: Partial<KeyLike>): KeyLike => ({
  key: '',
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...k,
})

describe('快捷键', () => {
  it('组合键在输入框里也认', () => {
    expect(shortcutOf(key({ ctrlKey: true, code: 'KeyK', key: 'k' }), 'text')).toBe('search')
    expect(shortcutOf(key({ metaKey: true, code: 'KeyK', key: 'k' }), 'none')).toBe('search')
    expect(shortcutOf(key({ ctrlKey: true, key: '.' }), 'text')).toBe('stop')
    // macOS 上 Alt+N 打出来的是「˜」，按 code 认
    expect(shortcutOf(key({ altKey: true, code: 'KeyN', key: '˜' }), 'empty')).toBe('new')
    expect(shortcutOf(key({ altKey: true, key: 'ArrowUp' }), 'empty')).toBe('prev')
    expect(shortcutOf(key({ altKey: true, key: 'ArrowDown' }), 'none')).toBe('next')
  })

  it('输入框里有字时不换页（会丢掉没发的字；macOS 上 ⌥↑↓ 是移动光标）', () => {
    expect(shortcutOf(key({ altKey: true, code: 'KeyN', key: '˜' }), 'text')).toBeNull()
    expect(shortcutOf(key({ altKey: true, key: 'ArrowUp' }), 'text')).toBeNull()
    expect(shortcutOf(key({ altKey: true, key: 'ArrowDown' }), 'text')).toBeNull()
  })

  it('单个字符只在没打字时认', () => {
    expect(shortcutOf(key({ key: '/' }), 'none')).toBe('focus')
    expect(shortcutOf(key({ key: '?', shiftKey: true }), 'none')).toBe('help')
    expect(shortcutOf(key({ key: '/' }), 'empty')).toBeNull()
    expect(shortcutOf(key({ key: '?', shiftKey: true }), 'text')).toBeNull()
  })

  it('不抢浏览器自己的组合、输入法组字时不算', () => {
    expect(shortcutOf(key({ ctrlKey: true, code: 'KeyN', key: 'n' }), 'none')).toBeNull()
    expect(shortcutOf(key({ ctrlKey: true, shiftKey: true, code: 'KeyK', key: 'K' }), 'none')).toBeNull()
    expect(shortcutOf(key({ ctrlKey: true, key: '/' }), 'none')).toBeNull()
    expect(shortcutOf(key({ ctrlKey: true, code: 'KeyK', key: 'k', isComposing: true }), 'none')).toBeNull()
  })
})
