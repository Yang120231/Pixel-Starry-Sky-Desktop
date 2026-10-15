import { describe, expect, it } from 'vitest'
import { EXT_ENGINE_CODES, EXT_ISSUE_CODES, EXT_ZIP_CODES, EXT_ZIP_FATAL, grammarIssue, zipIssue } from './codes'

describe('codes', () => {
  it('代码表排好序、没有重复', () => {
    expect([...EXT_ISSUE_CODES]).toEqual([...new Set(EXT_ISSUE_CODES)].sort())
  })
  it('引擎、zip 代码都在总表里；致命的 zip 代码是 zip 代码的子集', () => {
    for (const c of [...EXT_ENGINE_CODES, ...EXT_ZIP_CODES]) expect(EXT_ISSUE_CODES).toContain(c)
    for (const c of EXT_ZIP_FATAL) expect(EXT_ZIP_CODES as readonly string[]).toContain(c)
  })
  it('zipIssue：全部 error / pack / 上传拒绝，中英文说明都不为空', () => {
    for (const code of EXT_ZIP_CODES) {
      const i = zipIssue(code, { path: 'a/b.json', detail: 'why', dir: 'x/' })
      expect(i).toMatchObject({ code, severity: 'error', scope: 'pack', upload: 'reject', path: 'a/b.json' })
      expect(i.message.zh.length).toBeGreaterThan(0)
      expect(i.message.en.length).toBeGreaterThan(0)
    }
    expect(zipIssue('zip.nested', { dir: 'foo/' }).message.zh).toContain('foo/')
  })
  it('grammarIssue：严重度、范围、上传归宿按表', () => {
    const table: Record<string, [string, string, string]> = {
      'grammar.regex': ['error', 'contribution', 'reject'],
      'grammar.load': ['error', 'contribution', 'reject'],
      'grammar.hang': ['error', 'contribution', 'reject'],
      'grammar.slowLine': ['warning', 'contribution', 'reject'],
      'grammar.slowTotal': ['warning', 'contribution', 'reject'],
      'grammar.perfNearLimit': ['warning', 'contribution', 'hint'],
      'grammar.perfUnchecked': ['warning', 'pack', 'hint'],
    }
    for (const code of EXT_ENGINE_CODES) {
      const i = grammarIssue(code, {
        index: 2,
        path: 'g.json',
        pointer: '/a',
        line: 3,
        column: 4,
        detail: 'd',
        ms: 40,
        limitMs: 30,
      })
      const [severity, scope, upload] = table[code]
      expect(i, code).toMatchObject({ severity, scope, upload })
      expect(i.message.zh.length).toBeGreaterThan(0)
      expect(i.message.en.length).toBeGreaterThan(0)
      if (scope === 'contribution') expect(i.contribution).toEqual({ kind: 'grammars', index: 2 })
      else expect(i.contribution).toBeUndefined()
    }
  })
  it('grammarIssue：loc 在知道位置时填上', () => {
    expect(grammarIssue('grammar.regex', { index: 0, path: 'g.json', pointer: '/a', line: 3, column: 4 }).loc).toEqual({
      file: 'g.json',
      pointer: '/a',
      line: 3,
      column: 4,
    })
    expect(grammarIssue('grammar.slowLine', { index: 0, path: 'samples/a.x', line: 9 }).loc).toEqual({
      file: 'samples/a.x',
      line: 9,
    })
    expect(grammarIssue('grammar.hang', { index: 0, path: 'samples/a.x' }).loc).toBeUndefined()
  })
})
