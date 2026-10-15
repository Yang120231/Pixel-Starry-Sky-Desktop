import { describe, expect, it } from 'vitest'
import type { ExtPackIssue } from '@pixelsky/protocol'
import { fakePack } from '@/features/extpacks/testing'
import { contributionRows, filterPacks, grammarConflicts, issueText, packCategories } from './model'

const grammar = (over: Record<string, unknown> = {}) => ({
  scopeName: 'source.x',
  path: 'g.json',
  samples: [],
  ...over,
})

describe('packCategories / filterPacks', () => {
  const code = fakePack({
    key: 'a',
    id: 'p.code',
    contributes: { themes: [{ id: 't', label: '暗', uiTheme: 'dark', path: 't.json' }] },
  })
  const ai = fakePack({ key: 'b', id: 'p.ai', contributes: { skills: [{ path: 'skills/x' }] } })
  const both = fakePack({
    key: 'c',
    id: 'p.both',
    contributes: {
      snippets: [{ language: 'go', path: 's.json' }],
      prompts: [{ id: 'p', title: '审查', path: 'p.md' }],
    },
  })
  it('按内容分类，一个包可以两边都在', () => {
    expect(packCategories(code)).toEqual(['code'])
    expect(packCategories(ai)).toEqual(['ai'])
    expect(packCategories(both)).toEqual(['code', 'ai'])
    expect(packCategories(fakePack({ manifest: null }))).toEqual([])
  })
  it('分组和搜索', () => {
    const all = [code, ai, both]
    expect(filterPacks(all, 'all', '', 'zh-CN')).toHaveLength(3)
    expect(filterPacks(all, 'code', '', 'zh-CN').map(p => p.key)).toEqual(['a', 'c'])
    expect(filterPacks(all, 'ai', '', 'zh-CN').map(p => p.key)).toEqual(['b', 'c'])
    expect(filterPacks(all, 'all', ' P.AI ', 'zh-CN').map(p => p.key)).toEqual(['b'])
    expect(filterPacks(all, 'ai', 'p.code', 'zh-CN')).toEqual([])
  })
})

describe('contributionRows', () => {
  it('用清单下标，标出未生效和对应问题', () => {
    const issue: ExtPackIssue = {
      severity: 'error',
      scope: 'contribution',
      code: 'x',
      message: { zh: '坏了', en: 'broken' },
      contribution: { kind: 'themes', index: 1 },
    }
    const p = fakePack({
      contributes: {
        themes: [
          { id: 'a', label: 'A', uiTheme: 'dark', path: 'a.json' },
          { id: 'b', label: { zh: '乙', en: 'B' }, uiTheme: 'dark', path: 'b.json' },
        ],
        grammars: [grammar({ language: 'foo' })],
      },
      inactive: { themes: [1] },
      issues: [issue],
    })
    const rows = contributionRows(p, 'en-US')
    expect(rows.map(r => [r.kind, r.index, r.label, r.active])).toEqual([
      ['grammars', 0, 'foo', true],
      ['themes', 0, 'A', true],
      ['themes', 1, 'B', false],
    ])
    expect(rows[2].issues).toEqual([issue])
    expect(issueText(issue, 'en-US')).toBe('broken')
    expect(issueText(issue, 'zh-CN')).toBe('坏了')
  })
})

describe('grammarConflicts', () => {
  it('内置冲突和其他扩展冲突', () => {
    const me = fakePack({
      key: 'm',
      contributes: {
        grammars: [
          grammar({ language: 'svgx', extensions: ['.svg'] }),
          grammar({ language: 'k', extensions: ['.kk'] }),
        ],
      },
    })
    const other = fakePack({ key: 'o', id: 'o.pack', contributes: { grammars: [grammar({ extensions: ['.kk'] })] } })
    const off = fakePack({
      key: 'z',
      id: 'z.pack',
      enabled: false,
      live: false,
      contributes: { grammars: [grammar({ extensions: ['.kk'] })] },
    })
    expect(grammarConflicts(me, [me, other, off])).toEqual([
      { index: 0, overrideKey: 'svgx', builtin: ['XML'], otherPacks: [] },
      { index: 1, overrideKey: 'k', builtin: [], otherPacks: ['o.pack'] },
    ])
  })
})
