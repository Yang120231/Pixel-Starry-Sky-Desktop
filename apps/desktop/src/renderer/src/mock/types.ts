// 界面数据的类型。组件只依赖这里的类型和 data.ts 导出的值。

export interface CurrentUser {
  name: string
}

export interface RailItem {
  id: string
  label: string
  /** 图标名，由图标栏组件映射到具体 lucide 图标 */
  icon: 'workbench' | 'machines' | 'channels' | 'skills'
  badge?: number
  /** 红色提醒小圆点 */
  notify?: boolean
}

export type SessionStatus = 'idle' | 'running' | 'unread'

export interface Session {
  bottomedAt?: number | null
  archivedAt?: number | null
  id: string
  title: string
  status: SessionStatus
  /** 右侧时间，例如「刚刚」「3天」 */
  time?: string
}

export interface Project {
  id: string
  name: string
  branch?: string
  running?: boolean
  expanded?: boolean
  sessions: Session[]
  archived?: Session[]
}

export interface PinnedItem {
  id: string
  kind: 'board' | 'session'
  title: string
  /** 标题后面的灰色说明，例如「7 项进行中」 */
  meta?: string
  /** 右侧文字，例如「3 等你」 */
  trailing?: string
  unread?: boolean
}

export interface RecentItem {
  bottomedAt?: number | null
  id: string
  title: string
  project?: string
  time: string
  /** 右侧绿色 PR 图标 */
  hasPr?: boolean
}

export type ToolCall =
  | { kind: 'edit'; path: string; added: number; removed: number }
  | { kind: 'run'; command: string; ok: boolean; duration: string }

export interface ChangedFile {
  dir: string
  name: string
  added: number
  removed: number
  newText?: string
}

export interface ChangedFiles {
  added: number
  removed: number
  files: ChangedFile[]
}

export interface AssistantReply {
  intro: string
  bullets: Array<{ text: string; bold?: string; after?: string }>
  outro: string
}

export interface Attachment {
  id: string
  kind: 'browser' | 'screenshot' | 'file' | 'mode'
  label: string
}

export interface BrowserPage {
  id: string
  kind: 'site' | 'preview'
  title: string
}

export interface Annotation {
  id: number
  text: string
}

/** 一整套界面数据。empty.ts 是新用户的空界面，demo.ts 是照参考图写的演示数据 */
/** 可购买的订阅套餐（docs/ui/settings.md §9.6） */
export interface PlanOffer {
  id: string
  /** 与账号的 plan.name 相同即视为当前套餐 */
  name: string
  /** 售价，单位是 BillingCatalog.priceCurrency */
  price: number
  period: 'month' | 'quarter' | 'year'
  /** 套餐额度，单位是账号币种；缺省表示不限 / 不显示 */
  quotas: { daily?: number; weekly?: number; monthly?: number }
  features: string[]
  recommended?: boolean
}

/** 充值选项：到账额度 + 赠送额度（账号币种） */
export interface TopUpOption {
  credit: number
  bonus?: number
}

/** 购买订阅、充值用的商品数据；接入真实接口时只换这里 */
export interface BillingCatalog {
  /** 售价货币，例如 CNY */
  priceCurrency: string
  /** 1 单位额度 = 多少售价货币 */
  rate: number
  plans: PlanOffer[]
  planNote: string | null
  topUpOptions: TopUpOption[]
  /** 自定义金额范围，null 表示不支持自定义 */
  customTopUp: { min: number; max: number } | null
  paymentMethods: Array<{ id: string; label: string }>
  topUpNote: string | null
}

export interface AppData {
  /** 当前用户，null 表示未登录 */
  currentUser: CurrentUser | null
  railItems: RailItem[]
  pinned: PinnedItem[]
  projects: Project[]
  recent: RecentItem[]
  /** 侧边栏底部「N 运行中 / N 新回复」，null 时不显示 */
  runStatus: { running: number; newReplies: number } | null
  /** 默认选中的会话，null 表示新会话（显示欢迎页） */
  defaultSessionId: string | null
  /** 会话顶部的改动统计，null 时不显示 */
  sessionDiff: { added: number; removed: number } | null
  toolCalls: ToolCall[]
  assistantReply: AssistantReply | null
  changedFiles: ChangedFiles | null
  /** 演示对话这一轮的用量（回复下方统计行，docs/ui/usage.md §4）；null 时不显示 */
  turnUsage: import('@/components/session/TurnStats').TurnUsage | null
  attachments: Attachment[]
  composer: { placeholder: string; engine: { short: string; name: string }; effort: string }
  /** 输入框下方状态栏；branch / contextPercent 为 null 时不显示对应项 */
  composerStatus: { machine: string; branch: string | null; contextPercent: number | null }
  /** 启动时右侧面板是否打开 */
  defaultPanelOpen: boolean
  browserPages: BrowserPage[]
  /** 空字符串表示没有打开网页 */
  browserUrl: string
  annotations: Annotation[]
  /** 设置 → 账号里的订阅套餐、充值选项 */
  billing: BillingCatalog
  /** 协作频道（docs/ui/channels.md §9）；空界面没有频道 */
  channels: Channel[]
  channelMembers: ChannelMember[]
  /** 频道 id → 按时间排列的消息 */
  channelMessages: Record<string, ChannelMessage[]>
}

// ---------------------------------------------------------------------------
// 协作频道（docs/ui/channels.md §9）。Phase B 时迁到 packages/protocol。
// ---------------------------------------------------------------------------

export type ChannelAgentStatus = 'idle' | 'running' | 'waiting' | 'offline'

export interface HumanMember {
  id: string
  kind: 'human'
  name: string
  /** 当前用户自己 */
  you?: boolean
  role?: 'owner' | 'member'
  /** Phase C：平台用户 */
  userId?: string
}

export interface AgentMember {
  id: string
  kind: 'agent'
  name: string
  engine: import('@pixelsky/protocol').EngineId
  model: string | null
  /** 'local' 或 ssh-…（D055） */
  machineId: string
  /** 机器显示名 */
  machine: string
  project?: string | null
  status: ChannelAgentStatus
  /** 当前任务标题 */
  task?: string | null
  /** 绑定的会话 */
  sessionId?: string | null
  /** Phase C：AI 成员属于哪个真人 */
  ownerId?: string
}

export type ChannelMember = HumanMember | AgentMember

export interface Channel {
  id: string
  name: string
  topic: string | null
  project?: string | null
  /** local = 本机 AI 协作；team = 团队频道（Phase C） */
  scope: 'local' | 'team'
  memberIds: string[]
  unread: number
  /** 未读里有人 @你 */
  mentioned?: boolean
  createdAt: number
}

export type ChannelTaskStatus = 'queued' | 'running' | 'waiting' | 'done' | 'failed'

interface ChannelMessageBase {
  id: string
  channelId: string
  /** 毫秒时间戳 */
  at: number
}

export interface ChannelTextMessage extends ChannelMessageBase {
  kind: 'message'
  authorId: string
  text: string
  format: 'plain' | 'markdown'
  replyToId?: string | null
  mentions?: string[]
}

/** 派给 AI 成员的一项活；状态变化时原地更新，不追加新消息 */
export interface ChannelTask extends ChannelMessageBase {
  kind: 'task'
  authorId: string
  assigneeId: string
  title: string
  status: ChannelTaskStatus
  sessionId?: string | null
  summary?: string | null
  diff?: { added: number; removed: number } | null
}

export interface ChannelEvent extends ChannelMessageBase {
  kind: 'event'
  event: 'joined' | 'added' | 'renamed' | 'topic'
  actorId: string
  targetId?: string | null
  value?: string | null
}

export type ChannelMessage = ChannelTextMessage | ChannelTask | ChannelEvent
