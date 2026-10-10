import { describe, expect, it } from 'vitest'
import { FOLD_SHOW } from '@/ui/code/CodeBlock'
import { ROW, changesHeight, itemHeight, markdownHeight, toolsHeight } from './blockHeight'

const fence = (lines: number): string =>
  ['```ts', ...Array.from({ length: lines }, (_, i) => `line ${i}`), '```'].join('\n')

describe('markdownHeight', () => {
  it('正文按行，空行算段落间距', () => {
    expect(markdownHeight('一行')).toBe(26)
    expect(markdownHeight('一行\n\n两行')).toBe(26 + 10 + 26)
  })
  it('长行按宽度折行（中日韩字更宽）', () => {
    expect(markdownHeight('a'.repeat(220))).toBe(26 * 2)
    expect(markdownHeight('字'.repeat(110))).toBe(26 * 2)
  })
  it('代码块按行数；超过 30 行按折叠后的 20 行加展开按钮', () => {
    const short = markdownHeight(fence(10))
    const long = markdownHeight(fence(40))
    expect(short).toBe(56 + 20 * 10)
    expect(long).toBe(56 + 20 * FOLD_SHOW + 36)
  })
  it('没闭合的代码块（流式输出中）也算', () => {
    expect(markdownHeight('```ts\na\nb')).toBe(56 + 20 * 2)
  })
  it('有上限', () => {
    expect(markdownHeight('x\n'.repeat(100_000))).toBe(50_000)
  })
})

describe('itemHeight', () => {
  it('用户消息按行，回复按 Markdown，提示固定，其余一行', () => {
    expect(itemHeight({ kind: 'user', id: 'u', text: '一\n二', createdAt: 0 })).toBe(20 + 26 * 2)
    expect(itemHeight({ kind: 'assistant', id: 'a', text: '一行', status: 'completed' })).toBe(26)
    expect(itemHeight({ kind: 'notice', id: 'n', level: 'info', text: 'x' })).toBe(40)
    expect(itemHeight({ kind: 'reasoning', id: 'r', text: 'x', status: 'completed' })).toBe(ROW)
  })
  it('工具组和改动卡片', () => {
    expect(toolsHeight(3)).toBe(ROW * 3)
    expect(changesHeight(2)).toBe(76 + 68)
  })
})
