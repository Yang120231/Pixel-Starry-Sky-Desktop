import { describe, expect, it } from 'vitest'
import type { GitCommit } from '../../../../../shared/types/project-tools'
import { layoutGraph } from './graph'
import { commitTime, historyEntries, refBadges } from './historyModel'

const commit = (hash: string, parents: string[], refs: GitCommit['refs'] = []): GitCommit => ({
  hash,
  parents,
  author: 'a',
  email: 'a@x',
  authoredAt: 0,
  committedAt: 0,
  subject: hash,
  body: '',
  refs,
  stat: null,
})

describe('提交历史的显示模型', () => {
  it('引用标记：同名本地和远端合成一个，基础分支单独标，当前分支排最前', () => {
    expect(
      refBadges(
        [
          { kind: 'tag', name: 'v1' },
          { kind: 'remote', name: 'origin/main' },
          { kind: 'branch', name: 'main' },
          { kind: 'branch', name: 'feat/x', current: true },
          { kind: 'remote', name: 'origin/feat/x' },
          { kind: 'remote', name: 'upstream/other' },
        ],
        'main',
      ),
    ).toEqual([
      { kind: 'current', name: 'feat/x' },
      { kind: 'base', name: 'main' },
      { kind: 'remote', name: 'upstream/other' },
      { kind: 'tag', name: 'v1' },
    ])
    expect(
      refBadges(
        [
          { kind: 'branch', name: 'dev' },
          { kind: 'remote', name: 'origin/dev' },
        ],
        null,
      ),
    ).toEqual([{ kind: 'both', name: 'dev' }])
    expect(
      refBadges(
        [
          { kind: 'head', name: 'HEAD' },
          { kind: 'remote', name: 'origin/main' },
        ],
        'origin/main',
      ),
    ).toEqual([
      { kind: 'head', name: 'HEAD' },
      { kind: 'base', name: 'origin/main' },
    ])
  })

  it('时间：今天、昨天、更早', () => {
    const now = new Date(2026, 9, 11, 15, 0).getTime()
    expect(commitTime(new Date(2026, 9, 11, 13, 38).getTime(), now)).toMatch(/13:38/)
    expect(commitTime(new Date(2026, 9, 11, 13, 38).getTime(), now)).not.toMatch(/2026/)
    expect(commitTime(new Date(2026, 9, 10, 19, 4).getTime(), now)).toMatch(/19:04/)
    expect(commitTime(new Date(2026, 9, 9, 22, 48).getTime(), now)).toBe('2026/10/9 22:48')
  })

  it('未推送插在 HEAD 上方、未拉取插在上游最新提交上方；搜索时不插', () => {
    const commits = [
      commit('u', ['b'], [{ kind: 'remote', name: 'origin/f' }]),
      commit('h', ['b'], [{ kind: 'branch', name: 'f', current: true }]),
      commit('b', []),
    ]
    const rows = layoutGraph(commits)
    const ctx = { head: 'h', upstream: 'origin/f', ahead: 1, behind: 1 }
    const entries = historyEntries(commits, rows, ctx)
    expect(entries.map(e => (e.type === 'special' ? e.kind : e.commit.hash))).toEqual([
      'incoming',
      'u',
      'outgoing',
      'h',
      'b',
    ])
    const outgoing = entries[2]
    expect(outgoing.type === 'special' && outgoing.graph?.lane).toBe(rows[1].lane)
    expect(entries[3]).toMatchObject({ type: 'commit', head: true })
    expect(historyEntries(commits, null, ctx).map(e => e.type)).toEqual(['commit', 'commit', 'commit'])
    expect(historyEntries(commits, rows, { ...ctx, upstream: null }).map(e => e.type)).toEqual([
      'commit',
      'commit',
      'commit',
    ])
  })
})
