// 搜索结果按会话合并（docs/ui/conversation-ux-2.md §2.5）
import { describe, expect, it } from 'vitest'
import { searchTerms, type SearchResult } from '@pixelsky/protocol'
import { groupResults, titleFragments } from './groupResults'

const hit = (id: string, sessionId: string, kind: SearchResult['kind'], itemId: string | null = id): SearchResult => ({
  id,
  sessionId,
  itemId,
  kind,
  field: kind,
  title: '标题 ' + sessionId,
  projectId: 'p',
  projectName: 'P',
  engine: 'claude',
  updatedAt: 1,
  snippet: [],
  rank: 0,
})

describe('搜索结果按会话合并', () => {
  it('同一会话合成一行，顺序按第一次出现；摘要优先用对话内容的命中，标题命中不单列', () => {
    const groups = groupResults([
      hit('t1', 's1', 'title', null),
      hit('u1', 's1', 'user'),
      hit('a2', 's2', 'assistant'),
      hit('a1', 's1', 'assistant'),
    ])
    expect(groups.map(g => [g.key, g.head.id, g.rest.map(r => r.id), g.total])).toEqual([
      ['session:s1', 'u1', ['a1'], 2],
      ['session:s2', 'a2', [], 1],
    ])
  })

  it('总数用搜索给的会话命中数（每个会话最多只带最近 3 处）', () => {
    const many = (id: string) => ({ ...hit(id, 's1', 'assistant'), sessionMatches: 7 })
    const [g] = groupResults([hit('t1', 's1', 'title', null), many('a1'), many('a2'), many('a3')])
    expect([g.head.id, g.rest.length, g.total]).toEqual(['a1', 2, 7])
  })

  it('只有标题命中时就用标题；项目和手动任务各自一行', () => {
    const groups = groupResults([
      hit('t1', 's1', 'title', null),
      hit('project:p', '', 'project', null),
      hit('manual-task:1', '', 'todo'),
      hit('manual-task:2', '', 'todo'),
    ])
    expect(groups.map(g => [g.key, g.head.id, g.rest.length])).toEqual([
      ['session:s1', 't1', 0],
      ['project:p', 'project:p', 0],
      ['manual-task:1', 'manual-task:1', 0],
      ['manual-task:2', 'manual-task:2', 0],
    ])
  })

  it('标题里标出命中词', () => {
    expect(titleFragments('先看看 src/app.ts 的登录', searchTerms('登录 APP'))).toEqual([
      { text: '先看看 src/', match: false },
      { text: 'app', match: true },
      { text: '.ts 的', match: false },
      { text: '登录', match: true },
    ])
  })
})
