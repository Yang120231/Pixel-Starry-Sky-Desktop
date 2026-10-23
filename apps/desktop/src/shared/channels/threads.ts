// 任务卡 / 消息的讨论串（docs/ui/channels-collab-v2.md §3）：渲染层的串面板、回复数和主进程的频道工具用同一套规则。
import type { ChannelMessage, ChannelTextMessage } from '../types/channels'

/** 只在串里、不在主时间线显示的消息 */
export const threadOnly = (m: ChannelMessage): boolean => m.kind === 'message' && !!m.threadId

/**
 * 这条消息在不在 rootId（任务卡或消息）的串里：发在串里的、这张卡的结果，以及引用它的回复（以前「引用卡片再 @」的追加要求）。
 * 结果和引用回复仍在主时间线，串里也列出来
 */
export function inThread(m: ChannelMessage, rootId: string): m is ChannelTextMessage {
  if (m.kind !== 'message' || m.id === rootId) return false
  if (m.threadId) return m.threadId === rootId
  return m.taskId === rootId || m.replyToId === rootId
}

/** 串里的消息，从旧到新 */
export function threadMessages(messages: readonly ChannelMessage[], rootId: string): ChannelTextMessage[] {
  return messages.filter((m): m is ChannelTextMessage => inThread(m, rootId))
}

/** 每个串有几条回复、最新一条：主时间线卡片下面那一行用 */
export function threadStats(
  messages: readonly ChannelMessage[],
): Map<string, { count: number; last: ChannelTextMessage }> {
  const ids = new Set(messages.filter(m => m.kind !== 'event').map(m => m.id))
  const stats = new Map<string, { count: number; last: ChannelTextMessage }>()
  for (const m of messages) {
    if (m.kind !== 'message') continue
    const root = m.threadId ?? m.taskId ?? m.replyToId
    if (!root || root === m.id || !ids.has(root)) continue
    const prev = stats.get(root)
    stats.set(root, { count: (prev?.count ?? 0) + 1, last: !prev || m.at >= prev.last.at ? m : prev.last })
  }
  return stats
}
