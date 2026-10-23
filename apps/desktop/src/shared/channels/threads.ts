// 任务卡 / 消息的讨论串（docs/ui/channels-collab-v2.md §3）：渲染层的串面板、回复数和主进程的频道工具用同一套规则。
// 任务的结果消息属于这张卡的串：在结果上「在串里回复」、引用结果的回复，都归到卡片的串里
import type { ChannelMessage, ChannelTextMessage } from '../types/channels'

/** 只在串里、不在主时间线显示的消息 */
export const threadOnly = (m: ChannelMessage): boolean => m.kind === 'message' && !!m.threadId

/** 算不算未读：事件、自己发的不算；只在串里的回复只有 @ 到你才算（AI 在串里交流不刷未读） */
export const countsUnread = (m: ChannelMessage, selfId: string | null): boolean =>
  m.kind !== 'event' &&
  m.authorId !== selfId &&
  !(threadOnly(m) && !(selfId && m.kind === 'message' && m.mentions?.includes(selfId)))

/** 在 id 这条上开串时，串的根：串里的消息归到它所在的串，任务结果归到它的任务卡，其余就是它自己 */
export function threadRootOf(messages: readonly ChannelMessage[], id: string): string {
  const m = messages.find(x => x.id === id)
  const root = m?.kind === 'message' ? m.threadId || m.taskId || id : id
  // 根没读进来（更早的消息）时就在这条上开
  return root === id || messages.some(x => x.id === root && x.kind !== 'event') ? root : id
}

/** 任务结果 → 任务卡 */
function resultTasks(messages: readonly ChannelMessage[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of messages) if (m.kind === 'message' && m.taskId && !m.threadId) map.set(m.id, m.taskId)
  return map
}

/** 串里的消息，从旧到新：发在串里的、这张卡的结果，以及引用它（或它的结果）的回复 */
export function threadMessages(messages: readonly ChannelMessage[], rootId: string): ChannelTextMessage[] {
  const results = resultTasks(messages)
  const root = (id: string | null | undefined) => (id ? (results.get(id) ?? id) : null)
  return messages.filter((m): m is ChannelTextMessage => {
    if (m.kind !== 'message' || m.id === rootId) return false
    if (m.threadId) return root(m.threadId) === rootId
    return m.taskId === rootId || root(m.replyToId) === rootId
  })
}

/** 每个串有几条回复、最新一条：主时间线卡片下面那一行用 */
export function threadStats(
  messages: readonly ChannelMessage[],
): Map<string, { count: number; last: ChannelTextMessage }> {
  const ids = new Set(messages.filter(m => m.kind !== 'event').map(m => m.id))
  const results = resultTasks(messages)
  const stats = new Map<string, { count: number; last: ChannelTextMessage }>()
  for (const m of messages) {
    if (m.kind !== 'message') continue
    const raw = m.threadId ?? m.taskId ?? m.replyToId
    const root = raw ? (results.get(raw) ?? raw) : null
    if (!root || root === m.id || !ids.has(root)) continue
    const prev = stats.get(root)
    stats.set(root, { count: (prev?.count ?? 0) + 1, last: !prev || m.at >= prev.last.at ? m : prev.last })
  }
  return stats
}
