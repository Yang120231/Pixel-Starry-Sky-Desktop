import { describe, expect, it } from 'vitest'
import type { Project } from '@/data'
import type { SessionLane } from '@/features/board/sessionLanes'
import { filterProjects, filterSessions, laneMatches } from './runFilter'

const lanes = new Map<string, SessionLane>([
  ['run', 'running'],
  ['ask', 'waiting'],
  ['err', 'failed'],
  ['new', 'unread'],
])
const project = (id: string, sessions: string[]): Project => ({
  id,
  name: id,
  expanded: false,
  sessions: sessions.map(s => ({ id: s, title: s, status: 'idle' })),
  archived: [{ id: `${id}-old`, title: 'old', status: 'idle' }],
})

describe('侧栏按状态筛选', () => {
  it('运行中只认 running；等你包括等你处理、出错、已暂停、新回复', () => {
    expect(laneMatches('running', 'running')).toBe(true)
    expect(laneMatches('waiting', 'running')).toBe(false)
    for (const lane of ['waiting', 'failed', 'paused', 'unread'] as const)
      expect(laneMatches(lane, 'waiting')).toBe(true)
    expect(laneMatches('running', 'waiting')).toBe(false)
    expect(laneMatches(undefined, 'waiting')).toBe(false)
  })
  it('项目只留符合的会话、全部展开、不带归档；没有符合的项目不显示', () => {
    const out = filterProjects(
      [project('a', ['run', 'idle']), project('b', ['ask', 'err', 'new']), project('c', ['x'])],
      lanes,
      'waiting',
    )
    expect(out.map(p => p.id)).toEqual(['b'])
    expect(out[0].sessions.map(s => s.id)).toEqual(['ask', 'err', 'new'])
    expect(out[0]).toMatchObject({ expanded: true, archived: [] })
    expect(filterProjects([project('a', ['run', 'idle'])], lanes, 'running')[0].sessions.map(s => s.id)).toEqual([
      'run',
    ])
  })
  it('置顶的会话同样筛', () => {
    expect(filterSessions([{ id: 'run' }, { id: 'ask' }, { id: 'idle' }], lanes, 'running')).toEqual([{ id: 'run' }])
  })
})
