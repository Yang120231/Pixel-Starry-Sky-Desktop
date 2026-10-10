import { describe, expect, it } from 'vitest'
import { escapeStops } from './escapeStop'

const esc = { key: 'Escape', isComposing: false, defaultPrevented: false }

describe('escapeStops', () => {
  it('回复进行中按 Esc 停止', () => {
    expect(escapeStops(esc, true)).toBe(true)
  })
  it('没有在回复时不停', () => {
    expect(escapeStops(esc, false)).toBe(false)
  })
  it('输入法选字中不停', () => {
    expect(escapeStops({ ...esc, isComposing: true }, true)).toBe(false)
  })
  it('已经被别处处理（例如关闭智能体活动面板）时不停', () => {
    expect(escapeStops({ ...esc, defaultPrevented: true }, true)).toBe(false)
  })
  it('别的键不停', () => {
    expect(escapeStops({ ...esc, key: 'Enter' }, true)).toBe(false)
  })
})
