import { describe, expect, it, vi } from 'vitest'
import { switchStart } from './switchTiming'

vi.mock('@/features/engine/store', () => ({
  getEngineState: () => ({ snapshots: {} }),
  subscribeEngine: () => () => {},
}))

describe('switchStart', () => {
  it('1 秒内的点击、按键算起点', () => {
    expect(switchStart(5_000, 4_200)).toBe(4_200)
    expect(switchStart(5_000, 4_000)).toBe(4_000)
  })

  it('太久以前的输入、从没输入过：不量', () => {
    expect(switchStart(5_000, 3_999)).toBeNull()
    expect(switchStart(5_000, -Infinity)).toBeNull()
  })
})
