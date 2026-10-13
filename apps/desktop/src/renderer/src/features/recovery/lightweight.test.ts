import { describe, expect, it, vi } from 'vitest'
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

describe('什么时候开轻量模式', async () => {
  // lightweight.ts 会带进读 window 的 store，node 环境下先垫一个
  vi.stubGlobal('window', {})
  const { wantsLightweight } = await import('./lightweight')
  it('正常启动不开', () => {
    expect(wantsLightweight(null)).toBe(false)
  })
  it('内存不足、意外退出都开', () => {
    expect(wantsLightweight({ reason: 'oom', n: 1 })).toBe(true)
    expect(wantsLightweight({ reason: 'crashed', n: 2 })).toBe(true)
  })
  it('界面出错前 3 次不开，第 4 次起开', () => {
    expect(wantsLightweight({ reason: 'react-crash', n: 1 })).toBe(false)
    expect(wantsLightweight({ reason: 'react-crash', n: 3 })).toBe(false)
    expect(wantsLightweight({ reason: 'react-crash', n: 4 })).toBe(true)
  })
})
