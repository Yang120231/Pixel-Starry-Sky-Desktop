import { describe, expect, it } from 'vitest'
import { parseSnippetFile, toCodeMirrorTemplate as T } from './parse'

describe('toCodeMirrorTemplate', () => {
  it('tabstops', () => {
    expect(T('a $1 b ${2} c $0', {})).toBe('a ${1} b ${2} c ${0}')
  })
  it('defaults, linked fields', () => {
    expect(T('${1:foo} and $1', {})).toBe('${1:foo} and ${1}')
  })
  it('nested placeholders are flattened', () => {
    expect(T('${1:a ${2:b} $3 c}', {})).toBe('${1:a b  c}')
  })
  it('choice uses the first option', () => {
    expect(T('${1|postgres,mysql|}://', {})).toBe('${1:postgres}://')
  })
  it('escapes', () => {
    expect(T('\\$1 \\\\ x', {})).toBe('$1 \\ x')
    expect(T('${1:a\\}b}', {})).toBe('${1:ab}')
  })
  it('literal braces are escaped', () => {
    expect(T('f() { $0 }', {})).toBe('f() \\{ ${0} \\}')
  })
  it('dotenv: literal ${ then field 2', () => {
    expect(T('${1:NAME}=\\${${2:OTHER}}$0', {})).toBe('${1:NAME}=$\\{${2:OTHER}\\}${0}')
  })
  it('variables', () => {
    const vars = { TM_FILENAME: 'a.env', CURRENT_YEAR: '2026', TM_SELECTED_TEXT: '' }
    expect(T('$TM_FILENAME ${CURRENT_YEAR} ${TM_FILENAME:x}', vars)).toBe('a.env 2026 a.env')
    expect(T('${CLIPBOARD:none}', {})).toBe('none')
    expect(T('[$TM_SELECTED_TEXT]', vars)).toBe('[]')
  })
  it('unknown variables and transforms stay as raw text', () => {
    expect(T('$FOO ${BAR}', {})).toBe('$FOO $\\{BAR\\}')
    expect(T('${1/(.*)/$1/}', {})).toBe('$\\{1/(.*)/$1/\\}')
    expect(T('${FOO/a/b/}', {})).toBe('$\\{FOO/a/b/\\}')
  })
  it('variable values with braces are escaped', () => {
    expect(T('$CLIPBOARD', { CLIPBOARD: 'a{b}' })).toBe('a\\{b\\}')
  })
  it('stray $ stays', () => {
    expect(T('cost $ 5 ${', {})).toBe('cost $ 5 $\\{')
  })
})

describe('parseSnippetFile', () => {
  it('parses prefixes and bodies', () => {
    const { snippets, warnings } = parseSnippetFile({
      a: { prefix: ['x', 'y'], body: ['l1', 'l2'], description: 'd' },
      b: { prefix: 'z', body: 'one' },
    })
    expect(warnings).toEqual([])
    expect(snippets).toEqual([
      { name: 'a', prefixes: ['x', 'y'], body: 'l1\nl2', description: 'd' },
      { name: 'b', prefixes: ['z'], body: 'one', description: '' },
    ])
  })
  it('drops long prefixes and bad entries with warnings', () => {
    const { snippets, warnings } = parseSnippetFile({
      a: { prefix: ['ok', 'x'.repeat(31)], body: 'b' },
      b: { prefix: 'x'.repeat(31), body: 'b' },
      c: { prefix: 'c' },
      d: 5,
    })
    expect(snippets.map(s => [s.name, s.prefixes])).toEqual([['a', ['ok']]])
    expect(warnings.length).toBeGreaterThanOrEqual(4)
  })
  it('caps at 500', () => {
    const file: Record<string, unknown> = {}
    for (let i = 0; i < 600; i++) file[`s${i}`] = { prefix: `p${i}`, body: 'b' }
    const { snippets, warnings } = parseSnippetFile(file)
    expect(snippets.length).toBe(500)
    expect(warnings.length).toBe(1)
  })
  it('non-object file', () => {
    expect(parseSnippetFile([]).snippets).toEqual([])
    expect(parseSnippetFile(null).warnings.length).toBe(1)
  })
})
