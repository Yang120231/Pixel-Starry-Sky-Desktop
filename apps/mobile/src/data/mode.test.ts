import { describe, expect, it } from 'vitest'
import { modeChip, modelLabel } from './mode'

describe('modeChip', () => {
  it('names the four permission modes', () => {
    const text = (permissionMode: 'ask' | 'edits' | 'plan' | 'full') =>
      modeChip({ permissionMode, model: null, effort: null }).permission
    expect([text('ask'), text('edits'), text('plan'), text('full')]).toEqual([
      '每步问我',
      '自动改文件',
      '只规划',
      '完全放行',
    ])
  })

  it('hides model and effort when null', () => {
    expect(modeChip({ permissionMode: 'ask', model: null, effort: null })).toEqual({
      permission: '每步问我',
      model: null,
      effort: null,
    })
  })

  it('shows simplified model and effort labels', () => {
    expect(modeChip({ permissionMode: 'edits', model: 'claude-sonnet-4-5-20250929', effort: 'medium' })).toEqual({
      permission: '自动改文件',
      model: 'Sonnet 4.5',
      effort: '中',
    })
    const e = (effort: 'low' | 'high' | 'xhigh' | 'max') =>
      modeChip({ permissionMode: 'ask', model: null, effort }).effort
    expect([e('low'), e('high'), e('xhigh'), e('max')]).toEqual(['低', '高', '超高', '最高'])
  })
})

describe('modelLabel', () => {
  it('simplifies claude names', () => {
    expect(modelLabel('claude-opus-4-1-20250805')).toBe('Opus 4.1')
    expect(modelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
    expect(modelLabel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
    expect(modelLabel('sonnet')).toBe('Sonnet')
    expect(modelLabel('claude-opus-4-1[1m]')).toBe('Opus 4.1')
  })

  it('falls back to the raw name, truncated when long', () => {
    expect(modelLabel('gpt-5')).toBe('gpt-5')
    expect(modelLabel('my-custom-model-with-a-long-name')).toBe('my-custom-model-…')
  })
})
