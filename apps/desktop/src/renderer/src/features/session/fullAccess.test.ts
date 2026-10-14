import { describe, expect, it } from 'vitest'
import { needsFullConfirm, saferMode } from './fullAccess'

describe('完全放行的二次确认（docs/ui/full-access-confirm.md）', () => {
  it('只在从别的模式切进完全放行、没关提醒时确认', () => {
    expect(needsFullConfirm('edits', 'full', true)).toBe(true)
    expect(needsFullConfirm('ask', 'full', true)).toBe(true)
    // 已经是完全放行、往回切、关了提醒：都不问
    expect(needsFullConfirm('full', 'full', true)).toBe(false)
    expect(needsFullConfirm('full', 'edits', true)).toBe(false)
    expect(needsFullConfirm('edits', 'plan', true)).toBe(false)
    expect(needsFullConfirm('edits', 'full', false)).toBe(false)
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
