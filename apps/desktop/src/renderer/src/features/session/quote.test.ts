import { describe, expect, it } from 'vitest'
import { Text } from '@codemirror/state'
import {
  QUOTE_MAX_CHARS,
  QUOTE_MAX_LINES,
  fenceLanguage,
  quoteHeading,
  quotePath,
  quoteRange,
  quoteText,
  quoteTooLong,
} from './quote'

const doc = Text.of(['line one', '  line two', 'line three', 'line four'])
const pos = (line: number, column = 0) => doc.line(line).from + column

describe('引用的行范围', () => {
  it('选区按整行引用，保留缩进', () => {
    expect(quoteRange(doc, pos(2, 4), pos(3, 2))).toEqual({ startLine: 2, endLine: 3, code: '  line two\nline three' })
  })
  it('拖选到下一行行首时那一行不算；从下往上选也一样', () => {
    expect(quoteRange(doc, pos(1), pos(3))).toEqual({ startLine: 1, endLine: 2, code: 'line one\n  line two' })
    expect(quoteRange(doc, pos(3), pos(1))).toEqual({ startLine: 1, endLine: 2, code: 'line one\n  line two' })
  })
  it('没有选中时引用光标所在的那一行', () => {
    expect(quoteRange(doc, pos(4, 3), pos(4, 3))).toEqual({ startLine: 4, endLine: 4, code: 'line four' })
  })
})

describe('引用文字', () => {
  it('第一行是路径#L范围，下面是带语言的代码块；单行只写一个行号', () => {
    expect(quoteText('src/Main.java', { startLine: 12, endLine: 18, code: 'a\nb' })).toBe(
      'src/Main.java#L12-18\n```java\na\nb\n```',
    )
    expect(quoteText('Dockerfile', { startLine: 3, endLine: 3, code: 'FROM node' })).toBe(
      'Dockerfile#L3\n```dockerfile\nFROM node\n```',
    )
  })
  it('代码里有 ``` 时外层的反引号更多，不会提前结束', () => {
    const text = quoteText('README.md', { startLine: 1, endLine: 3, code: '```ts\nx\n```' })
    expect(text).toBe('README.md#L1-3\n````md\n```ts\nx\n```\n````')
  })
  it('语言标记用扩展名，没有扩展名时为空', () => {
    expect(fenceLanguage('a/b/App.TSX')).toBe('tsx')
    expect(fenceLanguage('deploy/Dockerfile.dev')).toBe('dockerfile')
    expect(fenceLanguage('Makefile')).toBe('')
    expect(fenceLanguage('.env')).toBe('')
  })
})

describe('大小上限', () => {
  it('行数或字数超过上限时给出实际大小', () => {
    expect(quoteTooLong({ startLine: 1, endLine: QUOTE_MAX_LINES, code: 'x' })).toBeNull()
    expect(quoteTooLong({ startLine: 1, endLine: QUOTE_MAX_LINES + 1, code: 'x' })).toEqual({
      lines: QUOTE_MAX_LINES + 1,
      chars: 1,
    })
    expect(quoteTooLong({ startLine: 1, endLine: 1, code: 'x'.repeat(QUOTE_MAX_CHARS + 1) })).toEqual({
      lines: 1,
      chars: QUOTE_MAX_CHARS + 1,
    })
  })
})

describe('引用里的路径', () => {
  it('会话就在文件所在的目录（大小写、斜杠方向不同也算）或还不知道时写相对路径', () => {
    expect(quotePath({ root: 'D:/work/app', path: 'src/a.ts' }, 'd:\\work\\app\\')).toBe('src/a.ts')
    expect(quotePath({ root: 'D:/work/app', path: 'src/a.ts' }, null)).toBe('src/a.ts')
  })
  it('会话在别的目录时写绝对路径', () => {
    expect(quotePath({ root: 'D:/work/lib/', path: 'src/a.ts' }, 'D:/work/app')).toBe('D:/work/lib/src/a.ts')
  })
})

describe('引用标题行', () => {
  it('认出路径#L12 和 路径#L12-18（也认 L12-L18）', () => {
    expect(quoteHeading('src/a.ts#L12-18')).toEqual({ path: 'src/a.ts', startLine: 12, endLine: 18 })
    expect(quoteHeading('src/a.ts#L12-L18')).toEqual({ path: 'src/a.ts', startLine: 12, endLine: 18 })
    expect(quoteHeading('a.ts#L7')).toEqual({ path: 'a.ts', startLine: 7, endLine: 7 })
  })
  it('前后有别的字、带空白、没有 #L 的都不算', () => {
    expect(quoteHeading('看 src/a.ts#L12')).toBeNull()
    expect(quoteHeading('src/a.ts')).toBeNull()
    expect(quoteHeading('src/a.ts#intro')).toBeNull()
  })
})
