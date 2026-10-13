import { describe, expect, it } from 'vitest'
import { DEFAULT_MODE_TRANSITION, parseModeTransition, transitionFor } from './modeTransitionModel'

describe('modeTransition', () => {
  it('默认滑动，认不出的值回到默认', () => {
    expect(DEFAULT_MODE_TRANSITION).toBe('slide')
    expect(parseModeTransition('fade')).toBe('fade')
    expect(parseModeTransition('off')).toBe('off')
    expect(parseModeTransition('bounce')).toBe('slide')
    expect(parseModeTransition(null)).toBe('slide')
  })

  it('关掉、动画关闭、系统减少动态效果、不支持时直接切', () => {
    expect(transitionFor('slide', 'on', false, true)).toBe('slide')
    expect(transitionFor('fade', undefined, false, true)).toBe('fade')
    expect(transitionFor('off', 'on', false, true)).toBeNull()
    expect(transitionFor('slide', 'off', false, true)).toBeNull()
    expect(transitionFor('slide', 'system', true, true)).toBeNull()
    expect(transitionFor('slide', 'system', false, true)).toBe('slide')
    // 「始终开启」时不管系统设置
    expect(transitionFor('slide', 'on', true, true)).toBe('slide')
    expect(transitionFor('slide', 'on', false, false)).toBeNull()
  })
})
