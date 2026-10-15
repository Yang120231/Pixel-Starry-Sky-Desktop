import { describe, expect, it } from 'vitest'
import { needsFullConfirm, saferMode } from './fullAccess'

describe('完全放行的二次确认', () => {
  it('从别的模式切进完全放行时每次都确认', () => {
    expect(needsFullConfirm('edits', 'full')).toBe(true)
    expect(needsFullConfirm('ask', 'full')).toBe(true)
    expect(needsFullConfirm('plan', 'full')).toBe(true)
    // 已经是完全放行、往回切：不问
    expect(needsFullConfirm('full', 'full')).toBe(false)
    expect(needsFullConfirm('full', 'edits')).toBe(false)
    expect(needsFullConfirm('edits', 'plan')).toBe(false)
  })

  it('改回：用新会话的默认；默认也是完全放行时用自动编辑，不支持就每次询问', () => {
    const all = ['ask', 'edits', 'plan', 'full'] as const
    expect(saferMode('plan', [...all])).toBe('plan')
    expect(saferMode('full', [...all])).toBe('edits')
    expect(saferMode(null, [...all])).toBe('edits')
    expect(saferMode('plan', ['ask', 'edits', 'full'])).toBe('edits')
    expect(saferMode('full', ['ask', 'full'])).toBe('ask')
  })
})
