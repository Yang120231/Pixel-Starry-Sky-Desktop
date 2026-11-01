import { describe, expect, it } from 'vitest'
import type { ProjectRecord, SessionSummary } from '@pixelsky/protocol'
import { filterTasks, projectGroups, projectNameOf, sessionList, sessionStatus, taskProjects } from './tasks'

const task = (
  id: string,
  title: string,
  projectId: string,
  updatedAt: number,
  state: SessionSummary['state'] = 'idle',
  engine: 'claude' | 'codex' = 'claude',
  archivedAt: number | null = null,
): SessionSummary => ({ record: { id, title, projectId, updatedAt, engine, archivedAt }, state }) as SessionSummary

const projects: ProjectRecord[] = [
  { id: 'web', name: 'Website', path: 'D:\\web', addedAt: 0 },
  { id: 'app', name: '手机 App', path: 'D:\\app', addedAt: 0 },
  { id: 'empty', name: '没任务的', path: 'D:\\empty', addedAt: 0 },
]
const sessions = [
  task('a', '修登录页的按钮', 'web', 5),
  task('b', 'Add Login tests', 'app', 9, 'running', 'codex'),
  task('c', '整理日志', 'app', 3),
  task('d', '归档了的登录', 'web', 10, 'idle', 'claude', 7),
]
const name = (s: SessionSummary) => projects.find(p => p.id === s.record.projectId)?.name ?? ''

describe('任务搜索和筛选', () => {
  it('标题、项目名、引擎名都能搜，多个词都要有，不分大小写', () => {
    expect(filterTasks(sessions, '登录', null, name).map(s => s.record.id)).toEqual(['a', 'd'])
    expect(filterTasks(sessions, 'login', null, name).map(s => s.record.id)).toEqual(['b'])
    expect(filterTasks(sessions, '手机 codex', null, name).map(s => s.record.id)).toEqual(['b'])
    expect(filterTasks(sessions, '  ', null, name)).toHaveLength(4)
  })

  it('按项目筛，可以和关键词一起用', () => {
    expect(filterTasks(sessions, '', 'app', name).map(s => s.record.id)).toEqual(['b', 'c'])
    expect(filterTasks(sessions, '日志', 'web', name)).toEqual([])
  })

  it('筛选用的项目只列有（没归档的）任务的，按最近一次任务排', () => {
    expect(taskProjects(sessions, projects).map(p => p.id)).toEqual(['app', 'web'])
  })

  it('会话列表：等你处理置顶，其余置顶的在前再按时间，不含归档；截断后告诉还有几条', () => {
    const pinned = {
      ...task('p', '置顶的', 'web', 1),
      record: { ...task('p', '置顶的', 'web', 1).record, pinnedAt: 1 },
    }
    const list = sessionList([...sessions, task('w', '等我', 'web', 2, 'waiting'), pinned as SessionSummary])
    expect(list.waiting.map(s => s.record.id)).toEqual(['w'])
    expect(list.rest.map(s => s.record.id)).toEqual(['p', 'b', 'a', 'c'])
    expect(list.more).toBe(0)
    const many = Array.from({ length: 7 }, (_, i) => task('t' + i, 't' + i, 'web', i))
    expect(sessionList(many, 5).rest.map(s => s.record.id)).toEqual(['t6', 't5', 't4', 't3', 't2'])
    expect(sessionList(many, 5).more).toBe(2)
  })

  it('一行的状态：等你处理、启动中、正在回复、上一轮出错；空闲是 null', () => {
    expect(sessionStatus(task('a', '', 'web', 1, 'waiting'))?.text).toBe('等你处理')
    expect(sessionStatus(task('a', '', 'web', 1, 'starting'))?.tone).toBe('online')
    expect(sessionStatus(task('a', '', 'web', 1, 'running'))?.text).toBe('正在回复…')
    const failed = task('a', '', 'web', 1)
    expect(sessionStatus({ ...failed, record: { ...failed.record, lastOutcome: 'failed' } })?.tone).toBe('warn')
    expect(sessionStatus(task('a', '', 'web', 1))).toBeNull()
  })

  it('项目分组：有会话的按最近活动排，没会话的在后，项目已不在的归到最后的「其他」', () => {
    const all = [
      ...sessions,
      task('w', '等我', 'web', 1, 'waiting'),
      task('x', '孤儿', 'gone', 4),
      task('y', '孤儿归档', 'gone', 2, 'idle', 'claude', 9),
    ]
    const groups = projectGroups(all, projects, () => 10)
    expect(groups.map(g => g.project?.id ?? null)).toEqual(['app', 'web', 'empty', null])
    // 等你处理的在前；归档的单独放
    expect(groups[1].sessions.map(s => s.record.id)).toEqual(['w', 'a'])
    expect(groups[1].archived.map(s => s.record.id)).toEqual(['d'])
    expect(groups[3].sessions.map(s => s.record.id)).toEqual(['x'])
    expect(groups[3].archived.map(s => s.record.id)).toEqual(['y'])
  })

  it('项目分组：不用项目的对话自成「对话」组，排在「其他」前面，不进「其他」；行里的项目名写「对话」', () => {
    const all = [...sessions, task('x', '孤儿', 'gone', 4), task('q', '随便问问', 'chat', 20)]
    const groups = projectGroups(all, projects, () => 10)
    expect(groups.map(g => g.project?.id ?? null)).toEqual(['app', 'web', 'empty', 'chat', null])
    expect(groups[3].project?.name).toBe('对话')
    expect(groups[3].sessions.map(s => s.record.id)).toEqual(['q'])
    expect(groups[4].sessions.map(s => s.record.id)).toEqual(['x'])
    expect(projectNameOf(projects, 'chat')).toBe('对话')
    expect(projectNameOf(projects, 'web')).toBe('Website')
    expect(projectNameOf(projects, 'gone')).toBe('')
  })

  it('项目分组：每组按自己的上限截断；只有归档会话的项目排在没有活动的位置；没有孤儿时没有「其他」', () => {
    const many = Array.from({ length: 4 }, (_, i) => task('t' + i, 't' + i, 'app', i + 1))
    const groups = projectGroups([...many, sessions[3]], projects, id => (id === 'app' ? 2 : 10))
    expect(groups.map(g => g.project?.id)).toEqual(['app', 'web', 'empty'])
    expect(groups[0].sessions.map(s => s.record.id)).toEqual(['t3', 't2'])
    expect(groups[0].more).toBe(2)
    expect(groups[1].sessions).toEqual([])
    expect(groups[1].archived).toHaveLength(1)
  })
})
