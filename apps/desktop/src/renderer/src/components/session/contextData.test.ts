import { describe, expect, it } from 'vitest'
import { contextNumber, contextPercentage, contextSegments } from './contextData'
import type { ContextWindow } from '@pixelsky/protocol'
const base: ContextWindow = { model: 'main', used: 160000, window: 200000, input: 10000, cacheRead: 140000, cacheWrite: 10000, output: 5000, observedAt: 1, source: 'request', stale: false, compacting: false, diagnostic: null, diagnosticStale: false }
describe('上下文显示', () => {
  it('展示有效零、未知、过期与超过容量的真实百分比', () => {
    expect(contextPercentage(base)).toBe(80)
    expect(contextPercentage({ ...base, used: 0 })).toBe(0)
    expect(contextPercentage({ ...base, used: 210000 })).toBe(105)
    expect(contextPercentage({ ...base, window: null })).toBeNull()
    expect(contextPercentage({ ...base, stale: true })).toBeNull()
    expect(contextNumber(null)).toBe('—'); expect(contextNumber(166000)).toBe('166k'); expect(contextNumber(1000000)).toBe('1m')
  })
  it('输入三段与剩余构成容量，输出不重复加进条形图', () => {
    const parts = contextSegments(base)
    expect(parts.map(p => p.tokens)).toEqual([10000, 140000, 10000, 40000])
    expect(parts.reduce((sum, p) => sum + p.tokens, 0)).toBe(200000)
    expect(contextSegments({ ...base, stale: true })).toEqual([])
  })
})
