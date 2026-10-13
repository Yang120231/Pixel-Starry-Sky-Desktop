import { describe, expect, it } from 'vitest'
import { RIGHT_VIEW_ORDER, resolveRightView, rightViewMeta } from './viewModel'

describe('right viewModel', () => {
  it('knows every view', () => {
    for (const v of RIGHT_VIEW_ORDER) {
      expect(resolveRightView(v)).toBe(v)
      expect(rightViewMeta(v).titleKey).toBe(`coding.right.view.${v}`)
    }
  })
  it('falls back to chat for unknown values', () => {
    expect(resolveRightView('nope')).toBe('chat')
    expect(resolveRightView(undefined)).toBe('chat')
    expect(resolveRightView('toString')).toBe('chat')
    expect(rightViewMeta(42).view).toBe('chat')
  })
})
