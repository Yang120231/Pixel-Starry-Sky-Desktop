import { describe, expect, it } from 'vitest'
import type { ProjectImportCandidate } from '../../../../../shared/types/project-import'
import {
  bucketOf,
  countBuckets,
  filterCandidates,
  isVisible,
  mergePicked,
  selectAllState,
  toolCounts,
} from './importModel'

const c = (path: string, extra: Partial<ProjectImportCandidate> = {}): ProjectImportCandidate => ({
  path,
  name: path.split('\\').pop()!,
  sources: ['Claude Code'],
  project: true,
  added: false,
  ...extra,
})

const list = [
  c('D:\\a'),
  c('D:\\b', { sources: ['Codex'] }),
  c('D:\\c', { added: true, sources: ['Claude Code', 'Codex'] }),
  c('D:\\gone', { issue: 'missing' }),
  c('D:\\manual', { sources: ['Folders'] }),
]

describe('settings project import model', () => {
  it('sorts candidates into addable, added and invalid', () => {
    expect(list.map(bucketOf)).toEqual(['addable', 'addable', 'added', 'invalid', 'addable'])
    expect(countBuckets(list, new Set())).toEqual({ addable: 3, added: 1, invalid: 1 })
  })

  it('hides only candidates whose every tool source is turned off', () => {
    const hidden = new Set(['Codex'])
    expect(isVisible(list[1], hidden)).toBe(false)
    expect(isVisible(list[2], hidden)).toBe(true)
    // 手动选的文件夹不受工具卡片影响
    expect(isVisible(list[4], new Set(['Claude Code', 'Codex']))).toBe(true)
    expect(countBuckets(list, hidden)).toEqual({ addable: 2, added: 1, invalid: 1 })
  })

  it('counts each tool card', () => {
    expect(toolCounts(list, 'Claude Code')).toEqual({ total: 3, addable: 1 })
    expect(toolCounts(list, 'Kimi Code')).toEqual({ total: 0, addable: 0 })
  })

  it('filters by bucket and search across name, path and source', () => {
    expect(filterCandidates(list, 'addable', '', new Set()).map(x => x.path)).toEqual(['D:\\a', 'D:\\b', 'D:\\manual'])
    expect(filterCandidates(list, 'addable', 'codex', new Set()).map(x => x.path)).toEqual(['D:\\b'])
    expect(filterCandidates(list, 'invalid', '', new Set()).map(x => x.path)).toEqual(['D:\\gone'])
  })

  it('reports the select-all state for selectable rows only', () => {
    const rows = filterCandidates(list, 'addable', '', new Set())
    expect(selectAllState(rows, new Set())).toBe('none')
    expect(selectAllState(rows, new Set(['D:\\a']))).toBe('some')
    expect(selectAllState(rows, new Set(rows.map(r => r.path)))).toBe('all')
    expect(selectAllState([list[2], list[3]], new Set())).toBe('none')
  })

  it('auto-picks new project-like candidates without re-picking ones the user cleared', () => {
    const picked = mergePicked(new Set(), new Set(['D:\\a']), [
      c('D:\\a'),
      c('D:\\new'),
      c('D:\\plain', { project: false }),
      c('D:\\c', { added: true }),
    ])
    expect([...picked]).toEqual(['D:\\new'])
    expect([...mergePicked(new Set(['D:\\c']), new Set(), [c('D:\\c', { added: true })])]).toEqual([])
  })
})
