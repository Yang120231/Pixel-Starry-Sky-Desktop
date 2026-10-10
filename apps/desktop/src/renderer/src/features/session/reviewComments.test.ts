import { describe, expect, it } from 'vitest'
import { reviewMessage } from './reviewComments'

describe('代码评论交给 AI 的消息', () => {
  it('按文件和行号排好，带上那一行代码，删除行标出来', () => {
    const text = reviewMessage([
      { id: '2', path: 'src/b.ts', line: 3, side: 'new', code: '  return x', text: '这里加个判断' },
      { id: '1', path: 'src/a.ts', line: 12, side: 'old', code: 'const x = 1', text: '为什么删掉\n还要用' },
    ])
    expect(text).toBe(
      [
        '请处理这些代码评论：',
        '',
        '1. src/a.ts 第 12 行（已删除的行）',
        '   > const x = 1',
        '   为什么删掉',
        '   还要用',
        '',
        '2. src/b.ts 第 3 行',
        '   > return x',
        '   这里加个判断',
      ].join('\n'),
    )
  })
})
