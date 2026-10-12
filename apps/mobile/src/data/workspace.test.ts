import { describe, expect, it } from 'vitest'
import type { ProjectRecord, SessionSummary } from '@pixelsky/protocol'
import { currentProject, projectGroups } from './workspace'

const project = (id: string, name = id): ProjectRecord => ({ id, name, path: 'C:/' + id, addedAt: 1 })
const session = (
  id: string,
  projectId: string,
  updatedAt: number,
  state: SessionSummary['state'] = 'idle',
  archivedAt: number | null = null,
): SessionSummary =>
  ({ record: { id, projectId, title: id, updatedAt, archivedAt }, state }) as unknown as SessionSummary

const projects = [project('web', '网站'), project('app', '安卓'), project('empty', '空项目')]
const sessions = [
  session('old', 'web', 1),
  session('new', 'web', 5),
  session('asks', 'web', 2, 'waiting'),
  session('runs', 'app', 3, 'running'),
  session('gone', 'app', 9, 'idle', 8),
]

describe('projectGroups', () => {
  it('keeps the desktop project order and puts waiting and running sessions first', () => {
    const groups = projectGroups(sessions, projects)
    expect(groups.map(g => g.project.id)).toEqual(['web', 'app', 'empty'])
    expect(groups[0].sessions.map(s => s.record.id)).toEqual(['asks', 'new', 'old'])
    expect(groups[0]).toMatchObject({ waiting: 1, running: 0 })
    expect(groups[1].sessions.map(s => s.record.id)).toEqual(['runs'])
    expect(groups[1]).toMatchObject({ waiting: 0, running: 1 })
    expect(groups[2].sessions).toEqual([])
  })

  it('filters by title, keeps whole projects whose name matches, hides the rest', () => {
    expect(projectGroups(sessions, projects, 'NEW').map(g => [g.project.id, g.sessions.length])).toEqual([['web', 1]])
    expect(projectGroups(sessions, projects, '安卓').map(g => [g.project.id, g.sessions.length])).toEqual([['app', 1]])
    expect(projectGroups(sessions, projects, '没有这个')).toEqual([])
  })
})

describe('currentProject', () => {
  it('prefers the open session, then the remembered project, then the latest activity', () => {
    expect(currentProject(projects, sessions, 'runs', 'web')?.id).toBe('app')
    expect(currentProject(projects, sessions, null, 'empty')?.id).toBe('empty')
    expect(currentProject(projects, sessions, null, 'deleted')?.id).toBe('web')
    expect(currentProject(projects, [], null, null)?.id).toBe('web')
    expect(currentProject([], [], null, null)).toBeNull()
  })
})
