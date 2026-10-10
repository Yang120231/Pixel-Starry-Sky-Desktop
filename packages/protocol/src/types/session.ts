import type { Effort, EngineId, PermissionMode } from './base'

/** 项目 = 一个工作目录 */
export interface ProjectRecord {
  id: string
  name: string
  path: string
  /** 毫秒时间戳 */
  addedAt: number
}

export type TurnOutcome = 'completed' | 'interrupted' | 'failed'

export interface SessionSettings {
  /** null/缺省为自有认证；平台记录分组与账号，避免跨账号扣费。 */
  platform?: { groupId: string; account: string } | null
  /** 自定义 API 的接口（docs/ui/custom-api.md）；模型仍在 model 里。和 platform 不能同时有 */
  provider?: { id: string } | null
  /** null 表示用引擎自己的默认模型 */
  model: string | null
  /** null 表示用引擎自己的默认强度 */
  effort: Effort | null
  permissionMode: PermissionMode
  /** Ultracode 开关（只有能力表里 ultracode 为真的引擎才有效） */
  ultracode: boolean
  /** Fast 模式（更快、更贵） */
  fast: boolean
  /** 显示思考摘要 */
  thinkingSummaries: boolean
}

/** 入队时固定成本相关设置；权限与会话开关在实际执行时读取。 */
export type QueueSettings = Pick<SessionSettings, 'model' | 'effort'> & {
  platform: NonNullable<SessionSettings['platform']> | null
  /** 旧的排队项没有这个字段，按 null 处理 */
  provider?: NonNullable<SessionSettings['provider']> | null
}

/** 用户输入的图片。Base64 只保存在本地队列 / 引擎发送链路，不进入搜索正文。 */
export interface ImageAttachment {
  id: string
  name: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  bytes: number
  width: number
  height: number
  dataBase64: string
}

export interface MessageInput {
  text: string
  clientMessageId: string
  attachments?: ImageAttachment[]
  settings?: QueueSettings
}

export type QueueStatus = 'queued' | 'dispatching' | 'running' | 'delivering' | 'failed' | 'uncertain'

export interface QueuedMessage {
  id: string
  text: string
  attachments?: ImageAttachment[]
  createdAt: number
  settings: QueueSettings
  status: QueueStatus
  error: string | null
  mode: 'normal' | 'guidance'
  attempt?: number
  messageUuid?: string
  /** 队列暂停时用户在空闲状态直接发送了新消息：这条旧排队项单独保持暂停，等「继续队列」 */
  held?: boolean
  /** 发送时没有对话在运行、前面也没有可执行的排队项：立即执行，不算排队。
   *  界面在对话里显示「正在启动」而不是放进消息队列；未能开始（被停止）时宿主清掉此标记。 */
  direct?: boolean
}

export interface SendReceipt {
  queueId: string
  status: 'queued' | 'accepted' | 'cancelled'
}

export interface SessionRecord extends SessionSettings {
  /** 持久化的列表置底偏好，旧记录为 null。 */
  bottomedAt?: number | null
  /** 用户显式改名后，不再生成首条消息的默认标题。 */
  titleEdited?: boolean
  /** 旧调用方可缺失，读取与新建时统一为 null；归档保留会话内容。 */
  archivedAt?: number | null
  id: string
  projectId: string
  /** 工作目录（创建时从项目复制，项目路径以后变了也不影响已有会话） */
  cwd: string
  engine: EngineId
  /** 引擎自己的会话 id（Claude 的 session_id / Codex 的 thread id）；还没启动过引擎时为 null */
  engineSessionId: string | null
  title: string
  createdAt: number
  updatedAt: number
  /** 最近一轮的结果；还没发过消息时为 null */
  lastOutcome: TurnOutcome | null
  /** 最近一轮失败时的错误摘要（最多 500 字），其余情况为 null；旧记录没有此字段（docs/ui/tasks-inbox.md） */
  lastError?: string | null
  /** 回退后尚未生效的引擎截断点（Claude 记录里的条目 uuid）：下次启动引擎时使用，成功启动后清空 */
  pendingRewind?: string | null
  /** 分叉出来、还没启动过引擎的会话：第一次启动时从原引擎会话的截断点复制（docs/ui/rewind-fork-sidechat.md §2） */
  pendingFork?: { from: string; at: string } | null
  /** 从哪个会话分叉出来的（顶部一行「分叉自『…』」） */
  forkedFrom?: { sessionId: string; title: string } | null
}

/** 回退要做什么（docs/ui/rewind-fork-sidechat.md §1）；省略时只回退对话 */
export interface RewindOptions {
  conversation: boolean
  code: boolean
}

/** 回退前的代码检查：要还原哪些文件；做不了时给原因 */
export type RewindCodePreview =
  | {
      ok: true
      /** 相对工作目录的路径（工作目录外的保持绝对路径） */
      files: string[]
      insertions: number
      deletions: number
      /** 还原前能不能先存一份以便撤销（总共不超过 20 MiB） */
      undoable: boolean
    }
  | { ok: false; reason: 'unsupported' | 'no-checkpoint' | 'failed'; message?: string }

export interface RewindPreview {
  code: RewindCodePreview
}

/** 回退结果：被移除的用户消息原文和图片，放回输入框（只恢复代码时为空）；能不能撤销 */
export interface RewindResult {
  text: string
  attachments?: ImageAttachment[]
  /** 还原了几个文件；没动代码时省略 */
  filesRestored?: number
  /** 发新消息或重启前可以撤销 */
  undoable?: boolean
}

/** 分叉结果：新会话，以及放进它输入框的原文和图片 */
export interface ForkResult {
  record: SessionRecord
  text: string
  attachments?: ImageAttachment[]
}

/** 旁聊里之前的一问一答 */
export interface SideTurn {
  question: string
  answer: string
}

/**
 * 会话运行状态（不保存，只在内存里）：
 * - idle 空闲
 * - starting 正在启动引擎
 * - running 这一轮正在进行
 * - waiting 等用户审批
 */
export type SessionState = 'idle' | 'starting' | 'running' | 'waiting'

/** 侧边栏用的会话摘要 */
export interface SessionSummary {
  record: SessionRecord
  state: SessionState
  /** 消息队列概况：有排队消息时才有（任务 › 待处理用，docs/ui/tasks-inbox.md）。queued 不含失败项 */
  queue?: QueueSummary
}

export interface QueueSummary {
  queued: number
  failed: number
  paused: boolean
}
