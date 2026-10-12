// 抽屉里的「工作区」（docs/mobile-remote.md §18.3）：按项目分组的会话、当前项目、展开了哪些项目。
import { useCallback, useState } from 'react'
import { containsTerms, searchTerms, type ProjectRecord, type SessionSummary } from '@pixelsky/protocol'
import { taskTitle } from './tasks'

/** 每个项目先列几个会话，点「显示更多」再加这么多 */
export const PROJECT_STEP = 6

export interface ProjectGroup {
  project: ProjectRecord
  /** 等你处理、运行中在前，其余按更新时间 */
  sessions: SessionSummary[]
  waiting: number
  running: number
}

const rank = (s: SessionSummary): number =>
  s.state === 'waiting' ? 0 : s.state === 'running' || s.state === 'starting' ? 1 : 2

/**
 * 项目按电脑上的顺序；每个项目里是没归档的会话。有搜索词时只留标题（或项目名）匹配的，
 * 没有匹配会话的项目不显示（项目名匹配时整个项目都留着）。
 */
export function projectGroups(
  sessions: readonly SessionSummary[],
  projects: readonly ProjectRecord[],
  query = '',
): ProjectGroup[] {
  const terms = searchTerms(query)
  const byProject = new Map<string, SessionSummary[]>()
  for (const s of sessions) {
    if (s.record.archivedAt) continue
    const list = byProject.get(s.record.projectId) ?? []
    list.push(s)
    byProject.set(s.record.projectId, list)
  }
  const groups: ProjectGroup[] = []
  for (const project of projects) {
    let list = byProject.get(project.id) ?? []
    if (terms.length && !containsTerms(project.name, terms)) {
      list = list.filter(s => containsTerms(taskTitle(s), terms))
      if (!list.length) continue
    }
    list = [...list].sort((a, b) => rank(a) - rank(b) || b.record.updatedAt - a.record.updatedAt)
    groups.push({
      project,
      sessions: list,
      waiting: list.filter(s => s.state === 'waiting').length,
      running: list.filter(s => s.state === 'running' || s.state === 'starting').length,
    })
  }
  return groups
}

/**
 * 当前项目（「新建会话」右边写的、工具按钮作用的）：正在看的会话的项目，其次上次选的，再其次最近有会话的，
 * 都没有时第一个项目。
 */
export function currentProject(
  projects: readonly ProjectRecord[],
  sessions: readonly SessionSummary[],
  openSession: string | null,
  remembered: string | null,
): ProjectRecord | null {
  const has = (id: string | null | undefined) => (id ? (projects.find(p => p.id === id) ?? null) : null)
  const fromSession = has(sessions.find(s => s.record.id === openSession)?.record.projectId)
  if (fromSession) return fromSession
  const chosen = has(remembered)
  if (chosen) return chosen
  const latest = [...sessions]
    .filter(s => !s.record.archivedAt)
    .sort((a, b) => b.record.updatedAt - a.record.updatedAt)[0]
  return has(latest?.record.projectId) ?? projects[0] ?? null
}

const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** 上次选的项目（每台电脑一个） */
export function rememberedProject(deviceId: string): string | null {
  return storage()?.getItem('pixelsky.m.project:' + deviceId) ?? null
}

export function rememberProject(deviceId: string, projectId: string): void {
  storage()?.setItem('pixelsky.m.project:' + deviceId, projectId)
}

/** 展开的项目（每台电脑记一份）；没记过时展开当前项目 */
export function useExpanded(deviceId: string): {
  expanded: (projectId: string, fallback: boolean) => boolean
  toggle(projectId: string, open: boolean): void
  only(projectId: string): void
} {
  const key = 'pixelsky.m.expanded:' + deviceId
  const [set, setSet] = useState<Set<string> | null>(() => {
    try {
      const raw = storage()?.getItem(key)
      return raw ? new Set(JSON.parse(raw) as string[]) : null
    } catch {
      return null
    }
  })
  const save = useCallback(
    (next: Set<string>) => {
      setSet(next)
      storage()?.setItem(key, JSON.stringify([...next]))
    },
    [key],
  )
  return {
    expanded: (id, fallback) => (set ? set.has(id) : fallback),
    toggle: (id, open) => {
      const next = new Set(set ?? [])
      if (open) next.add(id)
      else next.delete(id)
      save(next)
    },
    only: id => save(new Set([id])),
  }
}
