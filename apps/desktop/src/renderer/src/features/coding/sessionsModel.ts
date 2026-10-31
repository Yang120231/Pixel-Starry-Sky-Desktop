// 代码模式左栏「对话」、右栏会话列表用的当前项目会话（纯函数，不碰 window / data）
import type { SessionStatus } from '@/data/types'
import type { SidebarData } from '@/features/engine/hooks'
import { isChatProject } from '@pixelsky/protocol'

export interface ConversationEntry {
  id: string
  title: string
  status: SessionStatus
  time?: string
  pinned: boolean
}

/**
 * 置顶的会话已经从 project.sessions 里移走了（data/types.ts），要从 data.pinned 里按 projectId 合并回来；
 * 置顶的在前，再按侧栏顺序；不包括归档的
 */
export function projectConversations(data: SidebarData, projectId: string | null): ConversationEntry[] {
  if (!projectId) return []
  const pinned = data.pinned
    .filter(s => s.projectId === projectId && !s.archivedAt)
    .map(s => ({ id: s.id, title: s.title, status: s.status, time: s.time, pinned: true }))
  // 「对话」不在项目列表里：这个项目的会话就是侧栏「对话」分组那些
  const own = isChatProject(projectId) ? { sessions: data.chats } : data.projects.find(p => p.id === projectId)
  const seen = new Set(pinned.map(s => s.id))
  const rest = (own?.sessions ?? [])
    .filter(s => !s.archivedAt && !seen.has(s.id))
    .map(s => ({ id: s.id, title: s.title, status: s.status, time: s.time, pinned: false }))
  return [...pinned, ...rest]
}
