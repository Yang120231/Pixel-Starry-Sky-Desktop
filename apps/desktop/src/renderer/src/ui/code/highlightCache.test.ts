import { describe, expect, it } from 'vitest'
import { highlightTree } from './highlight'

describe('高亮结果缓存（docs/perf-audit-2026-10-18.md B4）', () => {
  it('同样的语言和内容：用上次的语法树，不再重新高亮', () => {
    const a = highlightTree('typescript', 'const a = 1')
    expect(highlightTree('typescript', 'const a = 1')).toBe(a)
    expect(highlightTree('javascript', 'const a = 1')).not.toBe(a)
    expect(highlightTree('typescript', 'const a = 2')).not.toBe(a)
  })
  it('总字数超过上限时丢最早的', () => {
    const first = highlightTree('plaintext', 'x'.repeat(1_200_000))
    highlightTree('plaintext', 'y'.repeat(1_200_000))
    expect(highlightTree('plaintext', 'x'.repeat(1_200_000))).not.toBe(first)
  })
})
