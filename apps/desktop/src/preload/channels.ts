import type {
  AgentInput,
  ChannelInput,
  ChannelMessage,
  ChannelMessagePush,
  ChannelsSnapshot,
  ChannelTaskAction,
  ChannelTextMessage,
  PostInput,
} from '../shared/types/channels'

/** 协作频道 Phase B（docs/ui/channels-phase-b.md §11） */
export interface ChannelsBridge {
  state(): Promise<ChannelsSnapshot>
  /** 一页消息（最多 200 条）；before 是毫秒时间戳，取这之前的 */
  messages(channelId: string, before?: number | null): Promise<{ messages: ChannelMessage[]; more: boolean }>
  create(input: ChannelInput): Promise<string>
  update(id: string, patch: { name?: string; topic?: string | null; projectId?: string | null }): Promise<void>
  delete(id: string): Promise<void>
  post(channelId: string, input: PostInput): Promise<{ message: ChannelTextMessage; tasks: string[] }>
  markRead(channelId: string): Promise<void>
  /** 新建或编辑 AI 成员；带 channelId 时顺便加进这个频道。返回成员 id */
  saveMember(channelId: string | null, input: AgentInput): Promise<string>
  addMember(channelId: string, memberId: string): Promise<void>
  removeMember(channelId: string, memberId: string): Promise<void>
  deleteMember(memberId: string): Promise<void>
  task(taskId: string, action: ChannelTaskAction): Promise<void>
  onChange(callback: (state: ChannelsSnapshot) => void): () => void
  onMessage(callback: (push: ChannelMessagePush) => void): () => void
}
