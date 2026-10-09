import type {
  ProjectRecord,
  QueueSettings,
  QueuedMessage,
  SessionRecord,
  SessionState,
  SessionSummary,
  TurnOutcome,
} from './session'
import type { EngineConfig, EngineInfo } from './engine'
import type { CacheWarning, RequestCacheUsage, RequestRetryState, TurnUsage, Usage } from './usage'
import type { Item } from './item'
import type { ApprovalRequest } from './approval'
import type { AgentRuns, BackgroundTask, SubagentStatus } from './agents'

export type EngineEvent =
  | { type: 'context'; context: import('../context').ContextWindow | null }
  | { type: 'request_retry'; retry: RequestRetryState | null }
  /** 仅主请求的单次缓存计数；瞬时事件，不落盘或写入会话快照。 */
  | { type: 'request_usage'; request: RequestCacheUsage }
  | { type: 'request_cache_reset' }
  | { type: 'status'; state: SessionState }
  /** 会话记录变了（标题、设置、引擎会话 id、最近结果） */
  | { type: 'record'; record: SessionRecord }
  | { type: 'turn_started'; turnId: string; execution?: QueueSettings }
  | { type: 'execution'; settings: QueueSettings }
  | { type: 'item_started'; item: Item }
  | { type: 'item_delta'; itemId: string; field: 'text' | 'output'; delta: string }
  /** 条目完成（完整内容）；id 没出现过时直接追加（例如提示类条目） */
  | { type: 'item_completed'; item: Item }
  | { type: 'approval_request'; request: ApprovalRequest }
  | { type: 'approval_resolved'; requestId: string }
  | { type: 'usage'; usage: Usage }
  /** 引擎报告的运行时能力（例如当前模型能不能开 Ultracode） */
  | { type: 'flags'; flags: SessionFlags }
  /** 后台任务列表变了（整个列表） */
  | { type: 'tasks'; tasks: BackgroundTask[] }
  /** 子智能体条变了（整个列表） */
  | { type: 'subagents'; subagents: SubagentStatus[] }
  /** 智能体追踪数据变了（整份） */
  | { type: 'runs'; runs: AgentRuns }
  /** 输入建议；null 表示清掉 */
  | { type: 'suggestion'; text: string | null }
  /** 回退：从这条条目起（含）之后全部移除 */
  | { type: 'items_truncated'; fromItemId: string }
  | { type: 'commands'; commands: import('../extensions').SkillCommand[] }
  | { type: 'queue'; items: QueuedMessage[]; paused: boolean }
  | { type: 'input_ack'; id: string; state: 'consumed' | 'cancelled' | 'uncertain'; mode?: 'normal' | 'guidance' }
  /** usage：这一轮的用量（引擎报告了才有，docs/ui/usage.md §6.1） */
  | { type: 'turn_completed'; turnId: string; outcome: TurnOutcome; error: string | null; usage?: TurnUsage }

/** 引擎运行时才知道的能力；null 表示还不知道（引擎还没启动） */
export interface SessionFlags {
  contextAvailable?: boolean
  compactAvailable?: boolean
  /** 经过验证且当前进程声明所需能力，才能开启引导 */
  steerAvailable?: boolean
  ultracodeAvailable: boolean | null
  /** Fast 模式现在能不能开 */
  fastAvailable: boolean | null
  /** Fast 模式实际状态：off / on / cooldown（限流后暂停） */
  fastState: 'off' | 'on' | 'cooldown' | null
  /** Fast 模式开不了的原因（CLI 给的代码，例如 not_first_party） */
  fastBlocked: string | null
}

/** 一个会话在界面上需要的全部状态 */
export interface SessionSnapshot {
  commands?: import('../extensions').SkillCommand[]
  /** 最近主请求 / 引擎诊断，独立于计费累计用量。旧快照无此字段时为未知。 */
  context?: import('../context').ContextWindow | null
  /** 当前模型请求的重试等待，完成/成功响应后清空，不落盘。 */
  retry?: RequestRetryState | null
  record: SessionRecord
  state: SessionState
  items: Item[]
  pending: ApprovalRequest[]
  usage: Usage | null
  flags: SessionFlags
  tasks: BackgroundTask[]
  subagents: SubagentStatus[]
  runs: AgentRuns
  /** 输入建议；没有时为 null */
  suggestion: string | null
  queue: QueuedMessage[]
  queuePaused: boolean
  execution: QueueSettings | null
  /** 正在进行的一轮；空闲时为 null */
  turnId: string | null
}

/** 打开会话的结果：快照 + 序号。界面只应用 seq 比它大的会话事件，避免打开过程中到达的事件漏掉或重复 */
export interface OpenedSession {
  snapshot: SessionSnapshot
  seq: number
}

/** 主进程广播给所有窗口的事件 */
export type HostEvent =
  | { kind: 'retry_settings'; settings: { maxRetries: number | null } }
  /** 设置 › 本机引擎改了（输入框的引擎菜单按 hidden 过滤） */
  | { kind: 'engine_config'; config: EngineConfig }
  | { kind: 'cache_warning'; warning: CacheWarning }
  /** seq：这个会话的事件序号，每个事件加一 */
  | { kind: 'session'; sessionId: string; seq: number; event: EngineEvent }
  | { kind: 'sessions'; sessions: SessionSummary[] }
  | { kind: 'projects'; projects: ProjectRecord[] }
  | { kind: 'engines'; engines: EngineInfo[] }
  /** 写入了新的用量记录（或清空了），用量页据此刷新 */
  | { kind: 'usage_recorded' }
