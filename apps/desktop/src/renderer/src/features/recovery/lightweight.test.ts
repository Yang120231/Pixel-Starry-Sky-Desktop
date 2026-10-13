import { describe, expect, it } from 'vitest'
import { LIGHTWEIGHT_TURNS, capTurns } from './turns'

describe('轻量模式的轮数', () => {
  it('轻量模式最多 20 轮，不管设置是 50 还是全部', () => {
    expect(capTurns(50, true)).toBe(LIGHTWEIGHT_TURNS)
    expect(capTurns(null, true)).toBe(LIGHTWEIGHT_TURNS)
    expect(capTurns(20, true)).toBe(20)
  })
  it('设置比 20 小的保持', () => {
    expect(capTurns(10, true)).toBe(10)
  })
  it('不是轻量模式照设置', () => {
    expect(capTurns(50, false)).toBe(50)
    expect(capTurns(null, false)).toBeNull()
  })
})
