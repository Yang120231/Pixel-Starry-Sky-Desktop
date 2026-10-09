import { describe, expect, it } from 'vitest'
import { diffFromHunks, diffText } from '../src/diff'

describe('diff', () => {
  it('逐行比对：保留上下文，统计增删', () => {
    const r = diffText('a\nb\nc\n', 'a\nB\nc\nd\n')
    expect(r.diff).toBe(' a\n-b\n+B\n c\n+d')
    expect(r).toMatchObject({ added: 2, removed: 1 })
  })

  it('Windows 换行和末尾空行不算改动', () => {
    expect(diffText('x\r\ny\r\n', 'x\ny').diff).toBe(' x\n y')
  })

  it('structuredPatch 转成带 @@ 的 diff', () => {
    const r = diffFromHunks([{ oldStart: 3, oldLines: 2, newStart: 3, newLines: 2, lines: [' keep', '-old', '+new'] }])
    expect(r.diff).toBe('@@ -3,2 +3,2 @@\n keep\n-old\n+new')
    expect(r).toMatchObject({ added: 1, removed: 1 })
  })
})
