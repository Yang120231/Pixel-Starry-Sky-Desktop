import { describe, expect, it } from 'vitest'
import { clipOutput } from './outputClip'

describe('工具输出按字数折叠', () => {
  it('不超过上限：不折叠', () => {
    expect(clipOutput('a'.repeat(100), 100, 10)).toBeNull()
  })
  it('超过上限：留开头、结尾，记下中间省掉多少字', () => {
    const text = 'h'.repeat(10) + 'm'.repeat(200) + 't'.repeat(10)
    expect(clipOutput(text, 100, 10)).toEqual({ head: 'h'.repeat(10), tail: 't'.repeat(10), hidden: 200 })
  })
})
