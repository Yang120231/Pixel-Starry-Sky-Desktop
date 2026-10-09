import { describe, expect, it } from 'vitest'
import { changedLines } from './gutter'
import { fileLanguage, loadLanguage } from './languages'
import { fileIndent, linePosition } from './positions'

describe('编辑器语言与定位', () => {
  it('计划内每种扩展名都有语言实现，未知文件保持纯文本', async () => {
    const cases = { ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX', json: 'JSON', css: 'CSS', html: 'HTML', md: 'Markdown', py: 'Python', rs: 'Rust', go: 'Go', yaml: 'YAML', toml: 'TOML', sh: 'Shell', sql: 'SQL' }
    for (const [ext, expected] of Object.entries(cases)) { expect(fileLanguage(`src/FILE.${ext.toUpperCase()}`)).toBe(expected); expect(await loadLanguage(`test.${ext}`)).toBeTruthy() }
    expect(fileLanguage('unknown.xyz')).toBe('纯文本')
    expect(await loadLanguage('unknown')).toEqual([])
  })
  it('行列定位裁切越界，兼容 CRLF、空行和中文', () => {
    expect(linePosition('一\r\n\r\n三', 3, 2)).toBe(4)
    expect(linePosition('abc\n', 99, 999)).toBe(4)
    expect(linePosition('abc', -1, -1)).toBe(0)
    expect(linePosition('', 10)).toBe(0)
  })
  it('从内容推断缩进，未缩进文件使用四空格', () => {
    expect(fileIndent('if {\n  a\n    b\n}')).toEqual({ unit: '  ', label: '空格: 2' })
    expect(fileIndent('a\n\tb')).toEqual({ unit: '\t', label: 'Tab' })
    expect(fileIndent('plain')).toEqual({ unit: '    ', label: '空格: 4' })
  })
})
describe('Git 行标记', () => {
  it('未修改不画标记；新增 / 修改 / 删除分别定位到当前行', () => {
    expect(changedLines('a\nb\n', 'a\nb\n')).toEqual([])
    expect(changedLines('a\nb\n', 'a\nnew\nb\n')).toEqual([{ line: 2, kind: 'added' }])
    expect(changedLines('a\nb\n', 'a\nchanged\n')).toEqual([{ line: 2, kind: 'modified' }])
    expect(changedLines('a\nb\nc\n', 'a\nc\n')).toEqual([{ line: 2, kind: 'deleted' }])
  })
  it('空文档与末尾删除仍返回有效行号，CRLF 不引入伪改动', () => {
    expect(changedLines('a\r\nb', 'a\nb')).toEqual([])
    expect(changedLines('a', '')).toEqual([{ line: 1, kind: 'deleted' }])
    expect(changedLines('', 'a')).toEqual([{ line: 1, kind: 'added' }])
  })
})
