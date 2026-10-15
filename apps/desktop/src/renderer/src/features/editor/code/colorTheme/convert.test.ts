import { describe, expect, it } from 'vitest'
import { tags } from '@lezer/highlight'
import { convertColors, convertTokenColors, mergeIncludes, normalizeHex } from './convert'

const ruleOf = (rules: ReturnType<typeof convertTokenColors>['rules'], tag: unknown) =>
  rules.find(r => r.tags.includes(tag as never))

describe('normalizeHex', () => {
  it('expands short forms and lowercases', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('#ABCD')).toBe('#aabbccdd')
    expect(normalizeHex('#AABBCC')).toBe('#aabbcc')
    expect(normalizeHex('#aabbcc80')).toBe('#aabbcc80')
  })
  it('rejects other forms', () => {
    expect(normalizeHex('red')).toBeNull()
    expect(normalizeHex('#12345')).toBeNull()
    expect(normalizeHex(5)).toBeNull()
  })
})

describe('convertTokenColors', () => {
  it('accepts string (comma split) and array scopes', () => {
    const { rules } = convertTokenColors([
      { scope: 'comment, string', settings: { foreground: '#111' } },
      { scope: ['keyword.control'], settings: { foreground: '#222222', fontStyle: 'italic bold' } },
    ])
    expect(ruleOf(rules, tags.comment)?.color).toBe('#111111')
    expect(ruleOf(rules, tags.string)?.color).toBe('#111111')
    expect(ruleOf(rules, tags.controlKeyword)).toMatchObject({
      color: '#222222',
      fontStyle: 'italic',
      fontWeight: 'bold',
    })
  })
  it('longer selector wins, then the later rule', () => {
    const { rules } = convertTokenColors([
      { scope: 'keyword.control', settings: { foreground: '#aaaaaa' } },
      { scope: 'keyword', settings: { foreground: '#bbbbbb' } },
      { scope: 'string', settings: { foreground: '#cccccc' } },
      { scope: 'string', settings: { foreground: '#dddddd' } },
    ])
    expect(ruleOf(rules, tags.controlKeyword)?.color).toBe('#aaaaaa')
    expect(ruleOf(rules, tags.keyword)?.color).toBe('#bbbbbb')
    expect(ruleOf(rules, tags.string)?.color).toBe('#dddddd')
  })
  it('maps property names and constant.language to null/atom', () => {
    const { rules } = convertTokenColors([
      { scope: 'support.type.property-name', settings: { foreground: '#123456' } },
      { scope: 'constant.language', settings: { foreground: '#654321' } },
    ])
    expect(ruleOf(rules, tags.propertyName)?.color).toBe('#123456')
    expect(ruleOf(rules, tags.null)?.color).toBe('#654321')
    expect(ruleOf(rules, tags.atom)?.color).toBe('#654321')
  })
  it('maps underline and strikethrough, ignores background and bad colours', () => {
    const { rules, warnings } = convertTokenColors([
      { scope: 'markup.underline.link', settings: { fontStyle: 'underline strikethrough', background: '#fff' } },
      { scope: 'comment', settings: { foreground: 'blue' } },
    ])
    expect(ruleOf(rules, tags.link)?.textDecoration).toBe('underline line-through')
    expect(ruleOf(rules, tags.comment)).toBeUndefined()
    expect(warnings).toHaveLength(1)
  })
  it('tolerates junk', () => {
    expect(convertTokenColors('x').rules).toEqual([])
    expect(convertTokenColors([null, 3, { scope: 1, settings: {} }]).rules).toEqual([])
  })
})

describe('convertColors', () => {
  it('maps the supported keys and ignores unknown ones', () => {
    const { chrome, diff } = convertColors(
      {
        'editor.background': '#1a1b26',
        'editor.foreground': '#a9b1d6',
        'editorLineNumber.foreground': '#444',
        'editorCursor.foreground': '#fff',
        'editorGutter.addedBackground': '#0f0',
        'diffEditor.insertedTextBackground': '#9ccc2c33',
        'nonsense.key': '#123456',
      },
      true,
    )
    expect(chrome['&']).toEqual({ backgroundColor: '#1a1b26', color: '#a9b1d6' })
    expect(chrome['.cm-gutters']).toEqual({ backgroundColor: '#1a1b26', color: '#444444' })
    expect(chrome['.cm-cursor, .cm-dropCursor']).toEqual({ borderLeftColor: '#ffffff' })
    expect(chrome['.cm-git-added']).toEqual({ borderLeftColor: '#00ff00' })
    expect(JSON.stringify(diff)).toContain('#9ccc2c33')
    expect(JSON.stringify(chrome)).not.toContain('123456')
  })
  it('gives a translucent selection fallback by mode', () => {
    expect(JSON.stringify(convertColors({ 'editor.background': '#000' }, true).chrome)).toContain('#ffffff26')
    expect(JSON.stringify(convertColors({ 'editor.background': '#fff' }, false).chrome)).toContain('#00000022')
  })
  it('returns empty for non-objects', () => {
    expect(convertColors(null, true)).toEqual({ chrome: {}, diff: {} })
  })
})

describe('mergeIncludes', () => {
  const files: Record<string, unknown> = {
    'themes/a.json': { include: './base.json', colors: { x: '1' }, tokenColors: [{ n: 'child' }] },
    'themes/base.json': { name: 'base', colors: { x: '0', y: '2' }, tokenColors: [{ n: 'base' }] },
    'loop.json': { include: 'loop.json' },
  }
  const load = async (p: string) => files[p]
  it('child overrides colours and its tokenColors come last', async () => {
    const merged = (await mergeIncludes(load, 'themes/a.json')) as Record<string, unknown>
    expect(merged.colors).toEqual({ x: '1', y: '2' })
    expect(merged.tokenColors).toEqual([{ n: 'base' }, { n: 'child' }])
    expect(merged.include).toBeUndefined()
  })
  it('stops runaway chains', async () => {
    await expect(mergeIncludes(load, 'loop.json')).rejects.toThrow(/deep/)
  })
  it('refuses to escape the extension', async () => {
    await expect(mergeIncludes(async () => ({ include: '../../x.json' }), 'a.json')).rejects.toThrow(/escapes/)
  })
})
