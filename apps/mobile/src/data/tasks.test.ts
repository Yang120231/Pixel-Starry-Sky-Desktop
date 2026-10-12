import { describe, expect, it } from 'vitest'
import type { ProjectRecord, SessionSummary } from '@pixelsky/protocol'
import { filterTasks, groupTasks, recentCount, taskProjects } from './tasks'

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

  it('「最近」按给的条数截断；recentCount 数的是没截断前有几条', () => {
    const many = Array.from({ length: 7 }, (_, i) => task('t' + i, 't' + i, 'web', i))
    expect(groupTasks(many, 5).recent.map(s => s.record.id)).toEqual(['t6', 't5', 't4', 't3', 't2'])
    expect(recentCount(many)).toBe(7)
    expect(recentCount(sessions)).toBe(2)
  })
})
