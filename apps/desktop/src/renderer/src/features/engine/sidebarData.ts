import { bottomOrder, pinnedOrder, type ProjectRecord, type SessionSummary } from '@pixelsky/protocol'
import type { Project, RecentItem, Session, SessionStatus } from '@/data/types'
import type { DemoSessionChange } from '@/data/types'
/** 运行中，或这一轮说完了但后台子智能体还在跑（docs/ui/notifications.md §7） */
export const busy = (s: SessionSummary): boolean => s.state !== 'idle' || !!s.background
/** 侧栏「置顶」分组里的会话：带上所属项目名 */
export type PinnedSession = Session & { project?: string; projectId?: string }
export function sidebarData(
  projects: ProjectRecord[],
  sessions: SessionSummary[],
  unread: Record<string, boolean>,
  time: (stamp: number) => string,
): {
  projects: Project[]
  pinned: PinnedSession[]
  recent: Array<RecentItem & { status: SessionStatus }>
} {
  const status = (s: SessionSummary): SessionStatus => (busy(s) ? 'running' : unread[s.record.id] ? 'unread' : 'idle')
  const row = (s: SessionSummary) => ({
    id: s.record.id,
    title: s.record.title,
    status: status(s),
    time: time(s.record.updatedAt),
    archivedAt: s.record.archivedAt ?? null,
    bottomedAt: s.record.bottomedAt ?? null,
    pinnedAt: s.record.pinnedAt ?? null,
  })
  const active = sessions.filter(s => !s.record.archivedAt),
    names = Object.fromEntries(projects.map(p => [p.id, p.name]))
  const result = projects.map(p => {
    const list = sessions.filter(s => s.record.projectId === p.id)
    return {
      id: p.id,
      name: p.name,
      expanded: true,
      running: list.some(s => !s.record.archivedAt && busy(s)),
      // 置顶的会话只显示在「置顶」分组
      sessions: list
        .filter(s => !s.record.archivedAt && !s.record.pinnedAt)
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
  const pinned = active
    .filter(s => s.record.pinnedAt)
    .map(s => ({ ...row(s), project: names[s.record.projectId], projectId: s.record.projectId }))
    .sort(pinnedOrder)
  return {
    projects: result,
    pinned,
    recent,
  }
}
/** 最近任务来自两个以上项目才显示：只有一个项目时它和项目列表完全重复（docs/ui/conversation-ux-2.md §2.3） */
export function recentSpansProjects(recent: Array<Pick<RecentItem, 'projectId' | 'project'>>): boolean {
  return new Set(recent.map(r => r.projectId ?? r.project ?? '')).size > 1
}

/** 停止只压掉「运行中」；传了 store 的未读就以它为准（归档后恢复的会话也能标未读） */
function demoStatus(status: SessionStatus, unread: boolean | undefined, tracked: boolean): SessionStatus {
  if (!tracked || status === 'running') return status
  return unread ? 'unread' : 'idle'
}

export function demoSidebarData(
  projects: Project[],
  recent: RecentItem[],
  changes: Record<string, DemoSessionChange>,
  /** 传了就以它为准判断未读（演示模式也走引擎 store 的未读） */
  unread?: Record<string, true>,
) {
  const deleted = (id: string) => changes[id]?.deleted
  const map = (s: Project['sessions'][number]) => ({
    ...s,
    title: changes[s.id]?.title ?? s.title,
    bottomedAt: changes[s.id]?.bottomedAt === undefined ? (s.bottomedAt ?? null) : changes[s.id].bottomedAt,
    pinnedAt: changes[s.id]?.pinnedAt === undefined ? (s.pinnedAt ?? null) : changes[s.id].pinnedAt,
    archivedAt: changes[s.id] ? changes[s.id].archivedAt : (s.archivedAt ?? null),
    status: demoStatus(changes[s.id]?.stopped ? 'idle' : s.status, unread?.[s.id], !!unread),
  })
  const result = projects.map(p => {
    const all = [...p.sessions, ...(p.archived ?? [])].filter(s => !deleted(s.id)).map(map)
    return {
      ...p,
      sessions: all.filter(s => !s.archivedAt && !s.pinnedAt).sort(bottomOrder),
      archived: all.filter(s => s.archivedAt).sort(bottomOrder),
      running: all.some(s => !s.archivedAt && s.status === 'running'),
    }
  })
  const pinned = projects
    .flatMap(p =>
      [...p.sessions, ...(p.archived ?? [])]
        .filter(s => !deleted(s.id))
        .map(map)
        .filter(s => !s.archivedAt && s.pinnedAt)
        .map(s => ({ ...s, project: p.name, projectId: p.id })),
    )
    .sort(pinnedOrder)
  const active = new Map([...result.flatMap(p => p.sessions), ...pinned].map(s => [s.id, s] as const)),
    allIds = new Set(projects.flatMap(p => [...p.sessions, ...(p.archived ?? [])].map(s => s.id)))
  const restored = projects.flatMap(p =>
    (p.archived ?? [])
      .filter(s => active.has(s.id))
      .map(s => ({ id: s.id, title: s.title, project: p.name, time: s.time ?? '' })),
  )
  return {
    projects: result,
    pinned,
    recent: [...restored, ...recent]
      .filter(s => !deleted(s.id) && (!allIds.has(s.id) || active.has(s.id)))
      .map(s => ({
        ...s,
        title: changes[s.id]?.title ?? s.title,
        bottomedAt: active.get(s.id)?.bottomedAt ?? changes[s.id]?.bottomedAt ?? null,
        pinnedAt: active.get(s.id)?.pinnedAt ?? changes[s.id]?.pinnedAt ?? null,
        status: active.get(s.id)?.status,
      }))
      .slice(0, 8)
      .sort(bottomOrder),
  }
}
