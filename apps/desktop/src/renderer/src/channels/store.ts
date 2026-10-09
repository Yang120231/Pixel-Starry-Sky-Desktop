// 协作频道的界面状态（docs/ui/channels.md §1.1）。Phase A 只有内存数据：演示模式来自 mock/channels.ts，
// 默认模式没有频道。Phase B 接入引擎后，isLive 时改从 window.pixelsky.channels 读写。
import { useSyncExternalStore } from 'react'
import { channelMembers, channelMessages, channels } from '@/mock/data'
import type { Channel, ChannelMember, ChannelMessage, ChannelTextMessage } from '@/mock/types'
import { appendMessage, createMessage, firstUnreadAt, markRead, unreadTotal } from './model'

export interface ChannelsState {
  channels: Channel[]
  members: ChannelMember[]
  messages: Record<string, ChannelMessage[]>
  /** 当前频道；null 时取第一个 */
  selectedId: string | null
  /** 频道 id → 正在回复的消息 id */
  replyTo: Record<string, string | null>
  /** 频道 id → 进入时「新消息」分隔线的位置 */
  newFrom: Record<string, number | null>
}

let state: ChannelsState = {
  channels,
  members: channelMembers,
  messages: channelMessages,
  selectedId: null,
  replyTo: {},
  newFrom: {},
}
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function set(next: Partial<ChannelsState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export const getChannelsState = (): ChannelsState => state

/** selector 必须返回 state 里已有的引用（或原始值），派生数据在组件里用 useMemo 算 */
export function useChannels<T>(selector: (s: ChannelsState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

export function useChannelUnreadTotal(): number {
  return useSyncExternalStore(subscribe, () => unreadTotal(state.channels))
}

/** 当前频道：选中的不存在时退回第一个 */
export function selectedChannel(s: ChannelsState): Channel | null {
  return s.channels.find(c => c.id === s.selectedId) ?? s.channels[0] ?? null
}

export const selfMember = (s: ChannelsState): ChannelMember | null =>
  s.members.find(m => m.kind === 'human' && m.you) ?? null

export const channelActions = {
  /** 进入频道：记下「新消息」位置并标为已读 */
  select(id: string): void {
    const channel = state.channels.find(c => c.id === id)
    if (!channel) return
    if (state.selectedId === id && channel.unread === 0 && !channel.mentioned) return
    const newFrom =
      channel.unread > 0 ? firstUnreadAt(state.messages[id] ?? [], channel.unread, selfMember(state)?.id ?? null) : null
    set({ selectedId: id, channels: markRead(state.channels, id), newFrom: { ...state.newFrom, [id]: newFrom } })
  },
  setReplyTo(channelId: string, messageId: string | null): void {
    if ((state.replyTo[channelId] ?? null) === messageId) return
    set({ replyTo: { ...state.replyTo, [channelId]: messageId } })
  },
  /** 以「你」的身份发一条消息（演示模式只追加到内存，AI 成员不会回复） */
  send(channelId: string, text: string): ChannelTextMessage | null {
    const body = text.trim()
    const self = selfMember(state)
    const channel = state.channels.find(c => c.id === channelId)
    if (!body || !self || !channel) return null
    const members = state.members.filter(m => channel.memberIds.includes(m.id))
    const message = createMessage({
      id: `local-${crypto.randomUUID()}`,
      channelId,
      authorId: self.id,
      text: body,
      replyToId: state.replyTo[channelId] ?? null,
      members,
      now: Date.now(),
    })
    set({ messages: appendMessage(state.messages, message), replyTo: { ...state.replyTo, [channelId]: null } })
    return message
  },
}
