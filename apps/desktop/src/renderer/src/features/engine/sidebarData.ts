import { bottomOrder, type ProjectRecord, type SessionSummary } from '@pixelsky/protocol'
import type { Project, RecentItem, SessionStatus } from '@/data/types'
import type { DemoSessionChange } from '@/data/types'
/** 底部运行状态胶囊展开后的一行：运行中的排前面，同组内保持会话列表顺序 */
export interface RunStatusItem {
  id: string
  title: string
  project?: string
  time?: string
  status: 'running' | 'unread'
}
export interface RunStatus {
  running: number
  newReplies: number
  items: RunStatusItem[]
}
const runOrder = (a: RunStatusItem, b: RunStatusItem) =>
  (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1)
export function sidebarData(
  projects: ProjectRecord[],
  sessions: SessionSummary[],
  unread: Record<string, boolean>,
  time: (stamp: number) => string,
): { projects: Project[]; recent: Array<RecentItem & { status: SessionStatus }>; runStatus: RunStatus | null } {
  const status = (s: SessionSummary): SessionStatus =>
    s.state !== 'idle' ? 'running' : unread[s.record.id] ? 'unread' : 'idle'
  const row = (s: SessionSummary) => ({
    id: s.record.id,
    title: s.record.title,
    status: status(s),
    time: time(s.record.updatedAt),
    archivedAt: s.record.archivedAt ?? null,
    bottomedAt: s.record.bottomedAt ?? null,
  })
  const active = sessions.filter(s => !s.record.archivedAt),
    names = Object.fromEntries(projects.map(p => [p.id, p.name]))
  const result = projects.map(p => {
    const list = sessions.filter(s => s.record.projectId === p.id)
    return {
      id: p.id,
      name: p.name,
      expanded: true,
      running: list.some(s => !s.record.archivedAt && s.state !== 'idle'),
      sessions: list
        .filter(s => !s.record.archivedAt)
        .map(row)
        .sort(bottomOrder),
      archived: list
        .filter(s => s.record.archivedAt)
        .map(row)
        .sort(bottomOrder),
    }
  })
  const recent = active
    .slice(0, 8)
    .map(s => ({
      ...row(s),
      project: names[s.record.projectId],
      projectId: s.record.projectId,
      time: time(s.record.updatedAt),
    }))
    .sort(bottomOrder)
  const running = active.filter(s => s.state !== 'idle').length,
    newReplies = active.filter(s => unread[s.record.id]).length
  const items = active
    .map(s => ({ s, status: status(s) }))
    .filter((x): x is { s: SessionSummary; status: RunStatusItem['status'] } => x.status !== 'idle')
    .map(({ s, status }) => ({
      id: s.record.id,
      title: s.record.title,
      project: names[s.record.projectId],
      time: time(s.record.updatedAt),
      status,
    }))
    .sort(runOrder)
  return { projects: result, recent, runStatus: running || newReplies ? { running, newReplies, items } : null }
}
/** 最近任务来自两个以上项目才显示：只有一个项目时它和项目列表完全重复（docs/ui/conversation-ux-2.md §2.3） */
export function recentSpansProjects(recent: Array<Pick<RecentItem, 'projectId' | 'project'>>): boolean {
  return new Set(recent.map(r => r.projectId ?? r.project ?? '')).size > 1
}

export function demoSidebarData(
  projects: Project[],
  recent: RecentItem[],
  runStatus: { running: number; newReplies: number } | null,
  changes: Record<string, DemoSessionChange>,
) {
  const deleted = (id: string) => changes[id]?.deleted
  const map = (s: Project['sessions'][number]) => ({
    ...s,
    title: changes[s.id]?.title ?? s.title,
    bottomedAt: changes[s.id]?.bottomedAt === undefined ? (s.bottomedAt ?? null) : changes[s.id].bottomedAt,
    archivedAt: changes[s.id] ? changes[s.id].archivedAt : (s.archivedAt ?? null),
    status: changes[s.id]?.stopped ? ('idle' as const) : s.status,
  })
  const result = projects.map(p => {
    const all = [...p.sessions, ...(p.archived ?? [])].filter(s => !deleted(s.id)).map(map)
    return {
      ...p,
      sessions: all.filter(s => !s.archivedAt).sort(bottomOrder),
      archived: all.filter(s => s.archivedAt).sort(bottomOrder),
      running: all.some(s => !s.archivedAt && s.status === 'running'),
    }
  })
  const active = new Map(result.flatMap(p => p.sessions.map(s => [s.id, s] as const))),
    allIds = new Set(projects.flatMap(p => [...p.sessions, ...(p.archived ?? [])].map(s => s.id)))
  const restored = projects.flatMap(p =>
    (p.archived ?? [])
      .filter(s => active.has(s.id))
      .map(s => ({ id: s.id, title: s.title, project: p.name, time: s.time ?? '' })),
  )
  const items = result
    .flatMap(p =>
      p.sessions
        .filter(s => s.status !== 'idle')
        .map(s => ({
          id: s.id,
          title: s.title,
          project: p.name,
          time: s.time,
          status: s.status as RunStatusItem['status'],
        })),
    )
    .sort(runOrder)
  return {
    projects: result,
    recent: [...restored, ...recent]
      .filter(s => !deleted(s.id) && (!allIds.has(s.id) || active.has(s.id)))
      .map(s => ({
        ...s,
        title: changes[s.id]?.title ?? s.title,
        bottomedAt: active.get(s.id)?.bottomedAt ?? changes[s.id]?.bottomedAt ?? null,
        status: active.get(s.id)?.status,
      }))
      .slice(0, 8)
      .sort(bottomOrder),
    runStatus: runStatus && { ...runStatus, items },
  }
}
