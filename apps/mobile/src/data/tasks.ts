// 任务列表分组（docs/mobile-remote.md §8.3）：等你处理、运行中、最近
import type { SessionSummary } from '@pixelsky/protocol'

export interface TaskGroups {
  waiting: SessionSummary[]
  running: SessionSummary[]
  recent: SessionSummary[]
}

const RECENT_LIMIT = 50

export function groupTasks(sessions: readonly SessionSummary[]): TaskGroups {
  const live = sessions.filter(s => !s.record.archivedAt)
  const byTime = (a: SessionSummary, b: SessionSummary) => b.record.updatedAt - a.record.updatedAt
  return {
    waiting: live.filter(s => s.state === 'waiting').sort(byTime),
    running: live.filter(s => s.state === 'running' || s.state === 'starting').sort(byTime),
    recent: live
      .filter(s => s.state === 'idle')
      .sort(byTime)
      .slice(0, RECENT_LIMIT),
  }
}

/** 列表里显示的标题：没有标题时用「未命名任务」 */
export function taskTitle(s: SessionSummary): string {
  return s.record.title.trim() || '未命名任务'
}

/** 「3 分钟前」这样的相对时间 */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}
