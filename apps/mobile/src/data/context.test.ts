import { describe, expect, it } from 'vitest'
import type { ContextWindow } from '@pixelsky/protocol'
import { contextLabel, contextNumber, contextUsage } from './context'

const ctx = (patch: Partial<ContextWindow>): ContextWindow => ({
  model: null,
  used: 124000,
  window: 200000,
  input: null,
  cacheRead: null,
  cacheWrite: null,
  output: null,
  observedAt: null,
  source: 'request',
  stale: false,
  compacting: false,
  diagnostic: null,
  diagnosticStale: false,
  ...patch,
})

describe('contextUsage', () => {
  it('computes percent, used and window', () => {
    expect(contextUsage(ctx({}))).toEqual({ percent: 62, used: 124000, window: 200000 })
  })

  it('is null when there is nothing trustworthy to draw', () => {
    expect(contextUsage(null)).toBeNull()
    expect(contextUsage(undefined)).toBeNull()
    expect(contextUsage(ctx({ stale: true }))).toBeNull()
    expect(contextUsage(ctx({ compacting: true }))).toBeNull()
    expect(contextUsage(ctx({ used: null }))).toBeNull()
    expect(contextUsage(ctx({ window: null }))).toBeNull()
    expect(contextUsage(ctx({ window: 0 }))).toBeNull()
    expect(contextUsage(ctx({ window: -5 }))).toBeNull()
    expect(contextUsage(ctx({ used: NaN }))).toBeNull()
    expect(contextUsage(ctx({ window: Infinity }))).toBeNull()
  })

  it('clamps percent to 100', () => {
    expect(contextUsage(ctx({ used: 250000 }))?.percent).toBe(100)
  })
})

describe('contextNumber', () => {
  it('abbreviates thousands and millions', () => {
    expect(contextNumber(999)).toBe('999')
    expect(contextNumber(124000)).toBe('124k')
    expect(contextNumber(1500)).toBe('1.5k')
    expect(contextNumber(1200000)).toBe('1.2M')
  })
})

describe('contextLabel', () => {
  it('reads like the screen-reader text', () => {
    const u = contextUsage(ctx({}))!
    expect(contextLabel(u)).toMatch(/62%/)
    expect(contextLabel(u)).toMatch(/124k \/ 200k/)
  })
})
