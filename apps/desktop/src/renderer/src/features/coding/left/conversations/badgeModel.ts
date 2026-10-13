// 对话图标上的小点：纯函数，不碰 window / data
import type { SessionLane } from '@/features/board/sessionLanes'

export interface BadgeEntry {
  id: string
  status: 'idle' | 'running' | 'unread'
}
export interface BadgeCard {
  id: string
  projectId: string | null
  lane: SessionLane
}

/**
 * 当前项目里有新回复没看的会话，或者看板分类是「等你」类（等批准 / 出错 / 已暂停 / 新回复）
 * 而会话本身不在运行中时，返回 true
 */
export function conversationsBadge(
  entries: readonly BadgeEntry[],
  cards: readonly BadgeCard[],
  projectId: string | null,
): boolean {
  if (!projectId) return false
  if (entries.some(e => e.status === 'unread')) return true
  const running = new Set(entries.filter(e => e.status === 'running').map(e => e.id))
  return cards.some(c => c.projectId === projectId && c.lane !== 'running' && !running.has(c.id))
}
