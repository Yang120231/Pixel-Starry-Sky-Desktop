// 对话区右键菜单的纯函数：引用文字、代码块围栏、大小上限、能不能直接搜、完整路径
import { describe, expect, it } from 'vitest'
import { QUOTE_MAX_CHARS, QUOTE_MAX_LINES } from '../quote'
import { absolutePath, cleanSelection, fencedBlock, findable, quoteBlock, quoteTooLong } from './transcriptTarget'

describe('引用', () => {
  it('每行加「> 」，空行只留「>」，去掉首尾空行，末尾换行', () => {
    expect(quoteBlock('\n\n第一行\r\n\r\n第三行  \n\n')).toBe('> 第一行\n>\n> 第三行\n')
  })
  it('选区去掉首尾空白行，中间的缩进保留', () => {
    expect(cleanSelection('\n  a\n    b\n\n')).toBe('  a\n    b')
  })
  it('超过行数或字数上限时给出实际大小', () => {
    expect(quoteTooLong('a\nb')).toBeNull()
    expect(quoteTooLong('x\n'.repeat(QUOTE_MAX_LINES))).toEqual({
      lines: QUOTE_MAX_LINES + 1,
      chars: QUOTE_MAX_LINES * 2,
    })
    expect(quoteTooLong('x'.repeat(QUOTE_MAX_CHARS + 1))).toEqual({ lines: 1, chars: QUOTE_MAX_CHARS + 1 })
  })
})

describe('代码块插进输入框', () => {
  it('带语言围起来', () => {
    expect(fencedBlock('const a = 1', 'ts')).toBe('```ts\nconst a = 1\n```\n')
    expect(fencedBlock('echo hi', null)).toBe('```\necho hi\n```\n')
  })
  it('内容里有 ``` 时围栏加长，不会提前结束', () => {
    expect(fencedBlock('```js\nx\n```', 'md')).toBe('````md\n```js\nx\n```\n````\n')
    expect(fencedBlock('`````', null)).toBe('``````\n`````\n``````\n')
  })
})

describe('在对话中搜索', () => {
  it('一行、100 字以内才直接搜', () => {
    expect(findable('error')).toBe(true)
    expect(findable('')).toBe(false)
    expect(findable('a\nb')).toBe(false)
    expect(findable('x'.repeat(101))).toBe(false)
  })
})

describe('完整路径', () => {
  it('Windows 目录用 \\', () => {
    expect(absolutePath('D:\\proj\\', 'src/a.ts')).toBe('D:\\proj\\src\\a.ts')
    expect(absolutePath('\\\\server\\share\\proj', 'a.ts')).toBe('\\\\server\\share\\proj\\a.ts')
  })
  it('WSL、SSH、macOS 的目录用 /', () => {
    expect(absolutePath('/home/u/proj/', 'src/a.ts')).toBe('/home/u/proj/src/a.ts')
  })
  it('不知道会话目录时为 null', () => {
    expect(absolutePath(null, 'a.ts')).toBeNull()
  })
})
