// 任务列表分组（docs/mobile-remote.md §8.3）：等你处理、运行中、最近；搜索和按项目筛选（§17 第 6 项）
import { ENGINES, containsTerms, searchTerms, type ProjectRecord, type SessionSummary } from '@pixelsky/protocol'

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

/** 列表里显示的标题：没有标题时用「未命名会话」 */
export function taskTitle(s: SessionSummary): string {
  return s.record.title.trim() || '未命名会话'
}

/** 「3 分钟前」这样的相对时间 */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}

/** 「最近」一共有几条（判断要不要「显示更多」） */
export const recentCount = (sessions: readonly SessionSummary[]): number =>
  sessions.filter(s => !s.record.archivedAt && s.state === 'idle').length

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
