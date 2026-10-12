// 协作频道的界面状态（docs/ui/channels.md §1.1；Phase B 见 docs/ui/channels-phase-b.md §11）。
// 演示模式：内存数据，来自 mock/channels.ts，AI 成员不会回复。
// 正式模式：数据都在主进程（main/core/channels/），这里订阅 channels:changed / channels:message，
// 进入频道时按页读消息，发消息、建频道、加成员都走 window.pixelsky.channels。
import { useSyncExternalStore } from 'react'
import { channelMembers, channelMessages, channels, isDemo } from '@/data'
import type { Channel, ChannelMember, ChannelMessage, ChannelTextMessage } from '@/data/types'
import type { AgentInput, ChannelInput, ChannelsSnapshot, ChannelTaskAction } from '../../../../shared/types/channels'
import { getPage, subscribePage } from '@/features/layout/page'
import { appendMessage, createMessage, firstUnreadAt, markRead, unreadTotal } from './model'

/** 正式模式的桥接；演示模式和没有 preload 时为 undefined */
export const channelsBridge = isDemo ? undefined : window.pixelsky?.channels
export const channelsLive = !!channelsBridge

export interface ChannelsState {
  /** 正式模式已经从主进程拿到频道列表 */
  ready: boolean
  channels: Channel[]
  members: ChannelMember[]
  messages: Record<string, ChannelMessage[]>
  /** 频道 id → 前面还有更早的消息（正式模式分页） */
  more: Record<string, boolean>
  /** 当前频道；null 时取第一个 */
  selectedId: string | null
  /** 频道 id → 正在回复的消息 id */
  replyTo: Record<string, string | null>
  /** 频道 id → 进入时「新消息」分隔线的位置 */
  newFrom: Record<string, number | null>
  /** 频道开出来的会话 → 频道名 */
  sessionChannels: Record<string, string>
}

let state: ChannelsState = {
  ready: !channelsLive,
  channels: channelsLive ? [] : channels,
  members: channelsLive ? [] : channelMembers,
  messages: channelsLive ? {} : channelMessages,
  more: {},
  selectedId: null,
  replyTo: {},
  newFrom: {},
  sessionChannels: {},
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
export const getChannels = (): ChannelsState => state

/** selector 必须返回 state 里已有的引用（或原始值），派生数据在组件里用 useMemo 算 */
export function useChannels<T>(selector: (s: ChannelsState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

export function useChannelUnreadTotal(): number {
  return useSyncExternalStore(subscribe, () => unreadTotal(state.channels))
}

/** 会话是哪个频道开出来的（侧栏、看板显示 `# 频道名`） */
export function useSessionChannel(sessionId: string): string | null {
  return useSyncExternalStore(subscribe, () => state.sessionChannels[sessionId] ?? null)
}

/** 当前频道：选中的不存在时退回第一个 */
export function selectedChannel(s: ChannelsState): Channel | null {
  return s.channels.find(c => c.id === s.selectedId) ?? s.channels[0] ?? null
}

export const selfMember = (s: ChannelsState): ChannelMember | null =>
  s.members.find(m => m.kind === 'human' && m.you) ?? null

// ---------------------------------------------------------------------------
// 正式模式：和主进程同步
// ---------------------------------------------------------------------------

/** 按时间插入或替换一条消息 */
export function upsertMessage(list: readonly ChannelMessage[], message: ChannelMessage): ChannelMessage[] {
  const i = list.findIndex(m => m.id === message.id)
  if (i >= 0) {
    const next = list.slice()
    next[i] = message
    return next
  }
  if (!list.length || list[list.length - 1].at <= message.at) return [...list, message]
  const at = list.findIndex(m => m.at > message.at)
  return [...list.slice(0, at), message, ...list.slice(at)]
}

function applySnapshot(s: ChannelsSnapshot): void {
  const visible = getPage() === 'channels' ? (selectedChannel({ ...state, channels: s.channels })?.id ?? null) : null
  set({
    ready: true,
    channels: visible ? markRead(s.channels, visible) : s.channels,
    members: s.members,
    sessionChannels: s.sessionChannels,
  })
  if (visible && s.channels.some(c => c.id === visible && (c.unread > 0 || c.mentioned))) readLater(visible)
}

let readTimer: ReturnType<typeof setTimeout> | null = null
/** 正在看的频道来了新消息：稍后标为已读（连续来很多条时只发一次） */
function readLater(id: string): void {
  if (readTimer) clearTimeout(readTimer)
  readTimer = setTimeout(() => {
    readTimer = null
    void channelsBridge?.markRead(id).catch(() => {})
  }, 300)
}

const loading = new Set<string>()
/** 读一页消息；第一次进频道时顺便定「新消息」分隔线（unread：进入前的未读数），和消息一起更新，时间线只滚一次 */
async function loadMessages(id: string, older = false, unread = 0): Promise<void> {
  if (!channelsBridge || loading.has(id)) return
  loading.add(id)
  try {
    const before = older ? (state.messages[id]?.[0]?.at ?? null) : null
    const page = await channelsBridge.messages(id, before)
    const current = older ? (state.messages[id] ?? []) : []
    let list = [...page.messages, ...current]
    // 读的同时推过来的消息不能丢
    if (!older) for (const m of state.messages[id] ?? []) list = upsertMessage(list, m)
    const self = selfMember(state)?.id ?? null
    const newFrom = unread > 0 ? { ...state.newFrom, [id]: firstUnreadAt(list, unread, self) } : state.newFrom
    set({ messages: { ...state.messages, [id]: list }, more: { ...state.more, [id]: page.more }, newFrom })
  } finally {
    loading.delete(id)
  }
}

if (channelsBridge) {
  channelsBridge.onChange(applySnapshot)
  channelsBridge.onMessage(({ channelId, message }) => {
    const list = state.messages[channelId]
    // 还没读过这个频道的消息：等进入时一起读
    if (!list) return
    set({ messages: { ...state.messages, [channelId]: upsertMessage(list, message) } })
  })
  void channelsBridge.state().then(applySnapshot, () => set({ ready: true }))
  // 回到频道页：正在看的频道标为已读
  subscribePage(() => {
    const c = selectedChannel(state)
    if (getPage() === 'channels' && c && (c.unread > 0 || c.mentioned)) channelActions.select(c.id)
  })
}

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------

export const channelActions = {
  /** 进入频道：记下「新消息」位置并标为已读 */
  select(id: string): void {
    const channel = state.channels.find(c => c.id === id)
    if (!channel) return
    const loaded = !!state.messages[id]
    if (state.selectedId === id && channel.unread === 0 && !channel.mentioned && (loaded || !channelsLive)) return
    const self = selfMember(state)?.id ?? null
    const newFrom = channel.unread > 0 && loaded ? firstUnreadAt(state.messages[id] ?? [], channel.unread, self) : null
    set({ selectedId: id, channels: markRead(state.channels, id), newFrom: { ...state.newFrom, [id]: newFrom } })
    if (channelsBridge) {
      if (channel.unread > 0 || channel.mentioned) void channelsBridge.markRead(id).catch(() => {})
      if (!loaded) void loadMessages(id, false, channel.unread)
    }
  },
  loadOlder(id: string): Promise<void> {
    return loadMessages(id, true)
  },
  setReplyTo(channelId: string, messageId: string | null): void {
    if ((state.replyTo[channelId] ?? null) === messageId) return
    set({ replyTo: { ...state.replyTo, [channelId]: messageId } })
  },
  /**
   * 以「你」的身份发一条消息。正式模式交给主进程（解析 @、派活），失败时抛出原因；
   * 演示模式只追加到内存，AI 成员不会回复。
   */
  async send(channelId: string, text: string): Promise<void> {
    const body = text.trim()
    const replyToId = state.replyTo[channelId] ?? null
    if (!body) return
    if (channelsBridge) {
      const { message } = await channelsBridge.post(channelId, { text: body, replyToId, clientId: crypto.randomUUID() })
      const list = state.messages[channelId] ?? []
      set({
        messages: { ...state.messages, [channelId]: upsertMessage(list, message) },
        replyTo: { ...state.replyTo, [channelId]: null },
      })
      return
    }
    const self = selfMember(state)
    const channel = state.channels.find(c => c.id === channelId)
    if (!self || !channel) return
    const members = state.members.filter(m => channel.memberIds.includes(m.id))
    const message: ChannelTextMessage = createMessage({
      id: `local-${crypto.randomUUID()}`,
      channelId,
      authorId: self.id,
      text: body,
      replyToId,
      members,
      now: Date.now(),
    })
    set({ messages: appendMessage(state.messages, message), replyTo: { ...state.replyTo, [channelId]: null } })
  },
  async createChannel(input: ChannelInput): Promise<string> {
    const id = await channelsBridge!.create(input)
    const snapshot = await channelsBridge!.state()
    applySnapshot(snapshot)
    set({ selectedId: id, messages: { ...state.messages, [id]: state.messages[id] ?? [] } })
    void loadMessages(id)
    return id
  },
  updateChannel(id: string, patch: { name?: string; topic?: string | null; projectId?: string | null }): Promise<void> {
    return channelsBridge!.update(id, patch)
  },
  async deleteChannel(id: string): Promise<void> {
    await channelsBridge!.delete(id)
    const { [id]: _messages, ...messages } = state.messages
    set({ messages, selectedId: state.selectedId === id ? null : state.selectedId })
  },
  saveMember(channelId: string | null, input: AgentInput): Promise<string> {
    return channelsBridge!.saveMember(channelId, input)
  },
  addMember(channelId: string, memberId: string): Promise<void> {
    return channelsBridge!.addMember(channelId, memberId)
  },
  removeMember(channelId: string, memberId: string): Promise<void> {
    return channelsBridge!.removeMember(channelId, memberId)
  },
  deleteMember(memberId: string): Promise<void> {
    return channelsBridge!.deleteMember(memberId)
  },
  task(taskId: string, action: ChannelTaskAction): Promise<void> {
    return channelsBridge!.task(taskId, action)
  },
}
