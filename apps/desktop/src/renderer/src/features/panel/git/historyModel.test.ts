import { describe, expect, it } from 'vitest'
import type { GitCommit } from '../../../../../shared/types/project-tools'
import { layoutGraph } from './graph'
import { commitTime, historyEntries, refBadges, syncStates } from './historyModel'

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
    ).toMatchObject([
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
    ).toMatchObject([{ kind: 'both', name: 'dev' }])
    expect(
      refBadges(
        [
          { kind: 'head', name: 'HEAD' },
          { kind: 'remote', name: 'origin/main' },
        ],
        'origin/main',
      ),
    ).toMatchObject([
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

  it('未发布的分支：HEAD 上方插「还没发布」行，不能展开', () => {
    const commits = [commit('h', [])]
    const entries = historyEntries(commits, layoutGraph(commits), {
      head: 'h',
      upstream: null,
      ahead: 0,
      behind: 0,
      unpublished: true,
    })
    expect(entries[0]).toMatchObject({ type: 'special', kind: 'outgoing', unpublished: true })
  })

  it('标记跟线同色：当前分支用提交的状态，上游标记已推送、上游更新时是远程新提交', () => {
    const cur = [{ kind: 'branch' as const, name: 'main', current: true }]
    const up = [{ kind: 'remote' as const, name: 'origin/main' }]
    expect(refBadges(cur, null, { state: 'local', upstream: 'origin/main' })[0].tone).toBe('local')
    expect(refBadges(up, null, { state: 'synced', upstream: 'origin/main' })[0].tone).toBe('synced')
    expect(refBadges(up, null, { state: 'incoming', upstream: 'origin/main' })[0].tone).toBe('incoming')
    expect(refBadges(up, null, { state: 'synced', upstream: 'origin/dev' })[0].tone).toBe('neutral')
    expect(refBadges([{ kind: 'tag', name: 'v1' }], null, { state: 'local' })[0].tone).toBe('neutral')
  })
})

describe('同步状态 syncStates', () => {
  const g = (hash: string, ...parents: string[]) => ({ hash, parents })
  const obj = (m: Map<string, string>) => Object.fromEntries(m)

  it('线性：未推送 / 已推送的分界', () => {
    const cs = [g('c', 'b'), g('b', 'a'), g('a')]
    expect(obj(syncStates(cs, { head: 'c', upstreamTip: 'b', ahead: 1, behind: 0 }))).toEqual({
      c: 'local',
      b: 'synced',
      a: 'synced',
    })
  })

  it('有未拉取：只有上游能到的提交是 incoming', () => {
    const cs = [g('u2', 'u1'), g('u1', 'a'), g('a')]
    expect(obj(syncStates(cs, { head: 'a', upstreamTip: 'u2', ahead: 0, behind: 2 }))).toEqual({
      u2: 'incoming',
      u1: 'incoming',
      a: 'synced',
    })
  })

  it('分叉：本地和远程各有新提交', () => {
    const cs = [g('u', 'a'), g('h2', 'h1'), g('h1', 'a'), g('a')]
    expect(obj(syncStates(cs, { head: 'h2', upstreamTip: 'u', ahead: 2, behind: 1 }))).toEqual({
      u: 'incoming',
      h2: 'local',
      h1: 'local',
      a: 'synced',
    })
  })

  it('没有上游：已加载的 HEAD 可达提交都是未推送，别的分支没有状态', () => {
    const cs = [g('x', 'a'), g('h', 'a'), g('a')]
    expect(obj(syncStates(cs, { head: 'h', upstreamTip: null }))).toEqual({ h: 'local', a: 'local' })
  })

  it('上游顶端没加载到：都算未推送，知道 ahead 时只标前 ahead 个', () => {
    const cs = [g('c', 'b'), g('b', 'a'), g('a')]
    expect(obj(syncStates(cs, { head: 'c', upstreamTip: null, ahead: 99 }))).toEqual({
      c: 'local',
      b: 'local',
      a: 'local',
    })
    expect(obj(syncStates(cs, { head: 'c', upstreamTip: null, ahead: 1 }))).toEqual({
      c: 'local',
      b: 'synced',
      a: 'synced',
    })
  })

  it('数量和 ahead 对不上（历史被改写）：退回按 ahead 沿第一父链标', () => {
    const cs = [g('c', 'b'), g('b', 'a'), g('a'), g('t')]
    // 上游顶端 t 和 HEAD 没有共同祖先：算出 3 个未推送，但 ahead 是 1
    expect(obj(syncStates(cs, { head: 'c', upstreamTip: 't', ahead: 1, behind: 1 }))).toMatchObject({
      c: 'local',
      b: 'synced',
      a: 'synced',
      t: 'incoming',
    })
  })

  it('合并提交：两个父链都算', () => {
    const cs = [g('m', 'p', 'q'), g('q', 'a'), g('p', 'a'), g('a')]
    expect(obj(syncStates(cs, { head: 'm', upstreamTip: 'p', ahead: 2, behind: 0 }))).toEqual({
      m: 'local',
      q: 'local',
      p: 'synced',
      a: 'synced',
    })
  })

  it('HEAD 没加载到：空', () => {
    expect(syncStates([g('a')], { head: 'z', upstreamTip: null }).size).toBe(0)
  })
})
