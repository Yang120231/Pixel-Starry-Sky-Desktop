import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { getIndentation } from '@codemirror/language'
import { parseLanguageConfiguration, tmIndentService } from './languageConfig'

describe('parseLanguageConfiguration', () => {
  it('注释 → commentTokens', () => {
    const { data } = parseLanguageConfiguration({ comments: { lineComment: '//', blockComment: ['/*', '*/'] } })
    expect(data.commentTokens).toEqual({ line: '//', block: { open: '/*', close: '*/' } })
  })

  it('autoClosingPairs：字符串、数组、对象都认，多字符的开括号跳过', () => {
    const { data } = parseLanguageConfiguration({
      autoClosingPairs: ['{', ['(', ')'], { open: '"', close: '"' }, { open: '/*', close: '*/' }, '{'],
    })
    expect(data.closeBrackets?.brackets).toEqual(['{', '(', '"'])
  })

  it('indentationRules：非法正则被忽略', () => {
    const ok = parseLanguageConfiguration({
      indentationRules: { increaseIndentPattern: '\\{$', decreaseIndentPattern: '(' },
    })
    expect(ok.data.indent?.increase?.test('a {')).toBe(true)
    expect(ok.data.indent?.decrease).toBeUndefined()
  })

  it('不支持的键列在 ignored 里，非对象不抛错', () => {
    expect(parseLanguageConfiguration({ comments: {}, brackets: [], wordPattern: 'x' }).ignored).toEqual([
      'brackets',
      'wordPattern',
    ])
    expect(parseLanguageConfiguration(null)).toEqual({ data: {}, ignored: [] })
  })
})

describe('tmIndentService', () => {
  const indentAt = (doc: string, line: number, spec: Parameters<typeof tmIndentService>[0]) => {
    const state = EditorState.create({ doc, extensions: [tmIndentService(spec)] })
    return getIndentation(state, state.doc.line(line).from)
  }
  const spec = { indent: { increase: /\{\s*$/, decrease: /^\s*\}/ } }

  it('沿用上一个非空行，匹配 increase 多一级，匹配 decrease 少一级', () => {
    expect(indentAt('a {\n\nb', 3, spec)).toBe(2)
    expect(indentAt('  a {\n  }', 2, spec)).toBe(2)
    expect(indentAt('  a\nb', 2, spec)).toBe(2)
  })

  it('第一行、没有规则时不接管', () => {
    expect(indentAt('a', 1, spec)).toBeNull()
    expect(indentAt('a\nb', 2, {})).toBeNull()
  })
})
