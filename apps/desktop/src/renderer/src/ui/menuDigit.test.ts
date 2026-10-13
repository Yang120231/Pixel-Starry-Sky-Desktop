import { describe, expect, it } from 'vitest'
import { menuDigit, pickByDigit } from './menuDigit'

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('菜单里按数字选', () => {
  it('主键盘和小键盘的 1–9；0、带修饰键、输入法组字中都不算', () => {
    expect(menuDigit(key('Digit1'))).toBe(0)
    expect(menuDigit(key('Numpad9'))).toBe(8)
    expect(menuDigit(key('Digit0'))).toBe(-1)
    expect(menuDigit(key('KeyA'))).toBe(-1)
    expect(menuDigit(key('Digit2', { altKey: true }))).toBe(-1)
    expect(menuDigit(key('Digit2', { ctrlKey: true }))).toBe(-1)
    expect(menuDigit(key('Digit2', { shiftKey: true }))).toBe(-1)
    expect(menuDigit({ ...key('Digit2'), isComposing: true })).toBe(-1)
  })
  it('点第 N 个能点的项，超出范围不处理', () => {
    const clicked: number[] = []
    const items = [0, 1, 2].map(i => ({ click: () => clicked.push(i) }) as unknown as HTMLElement)
    expect(pickByDigit(key('Digit2'), items)).toBe(true)
    expect(pickByDigit(key('Digit4'), items)).toBe(false)
    expect(clicked).toEqual([1])
  })
})
