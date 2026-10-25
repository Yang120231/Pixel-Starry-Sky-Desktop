import { describe, expect, it } from 'vitest'
import { safeFileName } from './safeFileName'

describe('safeFileName', () => {
  it('replaces separators and Windows-illegal characters, then squeezes spaces', () => {
    expect(safeFileName(String.raw`a\b/c:d*e?f"g<h>i|j`, 80, 'x')).toBe('a b c d e f g h i j')
    expect(safeFileName('a\u0000\u001fb', 80, 'x')).toBe('a b')
  })

  it('cuts by characters without splitting a surrogate pair and falls back when nothing is left', () => {
    expect(safeFileName('😀😀😀', 2, 'x')).toBe('😀😀')
    expect(safeFileName(' / ', 80, 'conversation')).toBe('conversation')
  })
})
