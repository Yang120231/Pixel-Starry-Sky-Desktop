// 任务列表分组（docs/mobile-remote.md §8.3）：等你处理、运行中、最近；搜索和按项目筛选（§17 第 6 项）
import { ENGINES, containsTerms, searchTerms, type ProjectRecord, type SessionSummary } from '@pixelsky/protocol'
import { L } from '@/i18n'

export interface TaskGroups {
  waiting: SessionSummary[]
  running: SessionSummary[]
  recent: SessionSummary[]
}

/** 「最近」一次显示几条，点「显示更多」再加这么多 */
export const RECENT_STEP = 50

export function groupTasks(sessions: readonly SessionSummary[], recentLimit = RECENT_STEP): TaskGroups {
  const live = sessions.filter(s => !s.record.archivedAt)
  const byTime = (a: SessionSummary, b: SessionSummary) => b.record.updatedAt - a.record.updatedAt
  return {
    waiting: live.filter(s => s.state === 'waiting').sort(byTime),
    running: live.filter(s => s.state === 'running' || s.state === 'starting').sort(byTime),
    recent: live
      .filter(s => s.state === 'idle')
      .sort(byTime)
      .slice(0, recentLimit),
  }
}

/** 首页和抽屉的会话列表（C3，docs/mobile-remote.md §21.3）：「等你处理」置顶，其余里置顶的在前，再按时间排 */
export interface SessionList {
  waiting: SessionSummary[]
  rest: SessionSummary[]
  /** rest 截掉了几条（「显示更多」） */
  more: number
}

export function sessionList(sessions: readonly SessionSummary[], limit = RECENT_STEP): SessionList {
  const live = sessions.filter(s => !s.record.archivedAt)
  const byTime = (a: SessionSummary, b: SessionSummary) => b.record.updatedAt - a.record.updatedAt
  const pinned = (s: SessionSummary) => (s.record.pinnedAt ? 1 : 0)
  const rest = live.filter(s => s.state !== 'waiting').sort((a, b) => pinned(b) - pinned(a) || byTime(a, b))
  return {
    waiting: live.filter(s => s.state === 'waiting').sort(byTime),
    rest: rest.slice(0, limit),
    more: Math.max(0, rest.length - limit),
  }
}

/** 一行会话不是空闲时的状态（头像角上的点、第二行的字）；空闲时 null，第二行显示最后一句回复 */
export function sessionStatus(
  s: SessionSummary,
): { tone: 'danger' | 'online' | 'warn'; text: string; pulse?: boolean } | null {
  if (s.state === 'waiting') return { tone: 'danger', text: L('等你处理', 'Needs you') }
  if (s.state === 'starting') return { tone: 'online', text: L('正在启动…', 'Starting…'), pulse: true }
  if (s.state === 'running') return { tone: 'online', text: L('正在回复…', 'Replying…'), pulse: true }
  if (s.record.lastOutcome === 'failed') return { tone: 'warn', text: L('出错了', 'Error') }
  return null
}

/** 列表里显示的标题：没有标题时用「未命名会话」 */
export function taskTitle(s: SessionSummary): string {
  return s.record.title.trim() || L('未命名会话', 'Untitled conversation')
}

/** 「3 分钟前」这样的相对时间 */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return L('刚刚', 'Just now')
  if (s < 3600) {
    const n = Math.floor(s / 60)
    return L(`${n} 分钟前`, `${n} min ago`)
  }
  if (s < 86400) {
    const n = Math.floor(s / 3600)
    return L(`${n} 小时前`, n === 1 ? '1 hour ago' : `${n} hours ago`)
  }
  const n = Math.floor(s / 86400)
  return L(`${n} 天前`, n === 1 ? '1 day ago' : `${n} days ago`)
}

/**
 * 按关键词（标题、项目名、引擎名，多个词都要有，不分大小写）和项目筛任务。
 * 手机上有电脑推来的全部任务（最多 200 条），标题在这里筛；对话内容由电脑搜（网关的 search）。
 */
export function filterTasks(
  sessions: readonly SessionSummary[],
  query: string,
  projectId: string | null,
  projectName: (s: SessionSummary) => string,
): SessionSummary[] {
  const terms = searchTerms(query)
  return sessions.filter(s => {
    if (projectId && s.record.projectId !== projectId) return false
    if (!terms.length) return true
    return containsTerms([taskTitle(s), projectName(s), ENGINES[s.record.engine]?.name ?? ''].join(' '), terms)
  })
}

/** 有任务的项目，按最近一次任务的时间排（筛选用） */
export function taskProjects(sessions: readonly SessionSummary[], projects: readonly ProjectRecord[]): ProjectRecord[] {
  const latest = new Map<string, number>()
  for (const s of sessions) {
    if (s.record.archivedAt) continue
    latest.set(s.record.projectId, Math.max(latest.get(s.record.projectId) ?? 0, s.record.updatedAt))
  }
  return projects.filter(p => latest.has(p.id)).sort((a, b) => latest.get(b.id)! - latest.get(a.id)!)
}

/** 抽屉「项目」页的一组：一个项目和它的会话（project 为 null 是电脑上已经没有这个项目的「其他」） */
export interface ProjectGroup {
  project: ProjectRecord | null
  /** 没归档的会话：等你处理的在前，其余置顶的在前再按时间；已按 limit 截断 */
  sessions: SessionSummary[]
  /** sessions 截掉了几条 */
  more: number
  archived: SessionSummary[]
}

/**
 * 抽屉「项目」页的分组：有会话的项目按最近一次活动排在前，没有会话的项目（可以在里面新建）排在后面，
 * 项目已不在的会话归到最后的「其他」。limitOf 给每组（「其他」的 id 是空串）一次列几条。
 */
export function projectGroups(
  sessions: readonly SessionSummary[],
  projects: readonly ProjectRecord[],
  limitOf: (projectId: string) => number,
): ProjectGroup[] {
  const known = new Set(projects.map(p => p.id))
  const build = (project: ProjectRecord | null) => {
    const mine = sessions.filter(s => (project ? s.record.projectId === project.id : !known.has(s.record.projectId)))
    const list = sessionList(mine, limitOf(project?.id ?? ''))
    const latest = Math.max(0, ...mine.filter(s => !s.record.archivedAt).map(s => s.record.updatedAt))
    const archived = mine.filter(s => s.record.archivedAt).sort((a, b) => b.record.updatedAt - a.record.updatedAt)
    return { group: { project, sessions: [...list.waiting, ...list.rest], more: list.more, archived }, latest }
  }
  const built = projects.map(build)
  const active = built.filter(b => b.latest > 0).sort((a, b) => b.latest - a.latest)
  const idle = built.filter(b => b.latest === 0)
  const other = build(null).group
  return [...active, ...idle].map(b => b.group).concat(other.sessions.length || other.archived.length ? [other] : [])
}
