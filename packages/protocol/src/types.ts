// 统一协议的类型：引擎层（packages/engine）和界面（apps/desktop）共用。
// 不管底下跑的是 Claude Code 还是 Codex，界面只认这里的类型。规格见 docs/engines.md §4–§6、§8。

// ---------------------------------------------------------------------------
// 引擎
// ---------------------------------------------------------------------------

export type EngineId = 'claude' | 'codex'

/** 权限模式：每次询问 / 自动编辑 / 计划模式 / 完全放行（docs/engines.md §6） */
export type PermissionMode = 'ask' | 'edits' | 'plan' | 'full'

/** 推理强度：低 / 中 / 高 / 超高 / 极限 */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'

/** 引擎能力表：界面按它决定显示什么，组件里不判断是哪个引擎 */
export interface EngineCaps {
  /** 可直接发送图片内容块；缺省表示未接入。 */
  imageInput?: boolean
  /** 能中断当前这一轮 */
  interrupt: boolean
  /** 能恢复以前的会话 */
  resume: boolean
  /** 运行中引导；普通排队由宿主管理，不依赖这个能力 */
  steer: boolean
  /** 回退到某条用户消息之前（截断对话与引擎上下文） */
  rewind?: boolean
  /** 改模型 / 强度当轮生效（否则下一轮生效） */
  liveModelSwitch: boolean
  livePermissionSwitch: boolean
  /** 支持的权限模式 */
  permissionModes: PermissionMode[]
  /** 支持的推理强度，从低到高（滑块上的停靠点） */
  efforts: Effort[]
  /** 有 Ultracode 开关（Claude Code：每个任务都编排多个子智能体），能和任意推理强度搭配 */
  ultracode: boolean
  /** 有 Fast 模式开关 */
  fast: boolean
  /** 有「显示思考摘要」开关 */
  thinkingSummaries: boolean
  /** 报告后台任务（后台任务条） */
  backgroundTasks: boolean
  /** 有智能体追踪（子智能体条、追踪面板） */
  agentTrace: boolean
  /** 会给出输入建议 */
  promptSuggestions: boolean
  /** 审批时「始终允许」能选的范围；空数组表示没有「始终允许」 */
  alwaysScopes: AlwaysScope[]
  /** 报告花费（美元） */
  costUsd: boolean
}

/** 「始终允许」的范围：本会话 / 本项目 / 所有项目 */
export type AlwaysScope = 'session' | 'project' | 'user'

/**
 * 引擎状态：
 * - ready 可用
 * - missing 没找到可执行文件
 * - unauthenticated 没登录
 * - outdated 版本太低
 * - error 检测出错
 * - unsupported 像素星空还不支持（即将支持）
 */
export type EngineStatus = 'ready' | 'missing' | 'unauthenticated' | 'outdated' | 'error' | 'unsupported'

export interface EngineInfo {
  id: EngineId
  /** 显示名，例如「Claude Code」 */
  name: string
  /** 输入框里小方块上的两个字母，例如「Cc」 */
  short: string
  status: EngineStatus
  /** 检测到的版本号，例如「2.1.289」 */
  version: string | null
  /** 可执行文件路径 */
  path: string | null
  /** 不可用时告诉用户怎么解决的一句话 */
  message: string | null
  caps: EngineCaps
}

// ---------------------------------------------------------------------------
// 项目与会话记录（会保存到磁盘）
// ---------------------------------------------------------------------------

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
export type QueueSettings = Pick<SessionSettings, 'model' | 'effort'> & { platform: NonNullable<SessionSettings['platform']> | null }

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
}

/** 回退结果：被移除的用户消息原文和图片，放回输入框 */
export interface RewindResult {
  text: string
  attachments?: ImageAttachment[]
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

// ---------------------------------------------------------------------------
// 条目：对话流里的一块
// ---------------------------------------------------------------------------

export type ItemStatus = 'running' | 'completed' | 'failed' | 'declined' | 'interrupted'

export interface FileChange {
  path: string
  /** 编辑输入的新内容片段，用于编辑器定位；旧记录可能缺失。 */
  newText?: string
  kind: 'add' | 'update' | 'delete'
  /** unified diff 的正文（@@ 行和 +/-/空格 开头的行，没有文件头）；拿不到时为空字符串 */
  diff: string
  added: number
  removed: number
}

export interface TodoStep {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type ToolKind = 'read' | 'search' | 'web' | 'mcp' | 'task' | 'other'

export type Item =
  | { kind: 'user'; id: string; text: string; attachments?: ImageAttachment[]; createdAt: number; turnId?: string; mode?: 'normal' | 'guidance' }
  /** 助手回复，Markdown */
  | { kind: 'assistant'; id: string; text: string; status: ItemStatus }
  /** 思考过程，界面默认折叠 */
  | { kind: 'reasoning'; id: string; text: string; status: ItemStatus }
  | {
      kind: 'command'
      id: string
      command: string
      /** 命令说明（Claude 的 description），可能没有 */
      description: string | null
      output: string
      exitCode: number | null
      status: ItemStatus
      /** 是哪个子智能体调用的（名字）；主智能体调用时没有 */
      subagent?: string
    }
  | { kind: 'file_change'; id: string; changes: FileChange[]; status: ItemStatus; subagent?: string }
  | {
      kind: 'tool'
      id: string
      tool: ToolKind
      /** 原始工具名，例如「Read」「mcp__github__search」 */
      name: string
      /** 一行摘要，例如文件路径、搜索词、网址 */
      title: string
      output: string
      status: ItemStatus
      subagent?: string
    }
  | { kind: 'todo'; id: string; steps: TodoStep[]; status: ItemStatus }
  /** detail：引擎给出的原始报错详情（附加说明、错误类型、HTTP 状态码等），界面默认折叠 */
  | { kind: 'notice'; id: string; level: 'info' | 'warn' | 'error'; text: string; detail?: string | null }
  /** 一轮结束后的统计（耗时、token、费用、模型），显示在这一轮回复下方（docs/ui/usage.md §4） */
  | { kind: 'turn_stats'; id: string; turnId: string; outcome: TurnOutcome; usage: TurnUsage }

export type ItemKind = Item['kind']

// ---------------------------------------------------------------------------
// 审批
// ---------------------------------------------------------------------------

export interface QuestionOption {
  label: string
  description: string
}

export interface Question {
  allowOther?: boolean
  secret?: boolean
  id?: string
  question: string
  header: string
  options: QuestionOption[]
  multiSelect: boolean
}

export interface ApprovalRequest {
  formSchema?: unknown
  /** 原生请求限制；省略时兼容既有 Claude 决策。 */
  canAllow?: boolean
  canDeny?: boolean
  requestId: string
  /** 对应的工具条目（如果有） */
  itemId: string | null
  kind: 'command' | 'file_change' | 'tool' | 'question' | 'plan'
  /** 卡片标题，例如「运行命令」「修改文件」「使用 WebFetch」 */
  title: string
  command?: string
  /** 命令说明 */
  description?: string
  changes?: FileChange[]
  toolName?: string
  /** 其他工具的原始参数（JSON） */
  input?: unknown
  questions?: Question[]
  /** 计划模式下要用户确认的计划（Markdown） */
  plan?: string
  /** 「始终允许」能选的范围；空数组表示没有「始终允许」（问答、计划确认） */
  alwaysScopes: AlwaysScope[]
}

export type ApprovalDecision =
  | { type: 'form'; content: Record<string, unknown> }
  | { type: 'allow' }
  /** 允许，并且以后同类操作都允许（范围见 AlwaysScope） */
  | { type: 'allow_always'; scope: AlwaysScope }
  | { type: 'deny'; message?: string }
  /** 回答问题：键是问题原文，值是选中的选项（多选用「, 」连接） */
  | { type: 'answer'; answers: Record<string, string> }

// ---------------------------------------------------------------------------
// 用量
// ---------------------------------------------------------------------------

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** 当前上下文占用的 token 数 */
  contextTokens: number
  /** 上下文窗口大小；不知道时为 null */
  contextWindow: number | null
  /** 本会话累计花费（美元）；引擎不报告时为 null */
  costUsd: number | null
}

// ---------------------------------------------------------------------------
// 事件：引擎层 → 界面
// ---------------------------------------------------------------------------

export type EngineEvent =
  | { type: 'context'; context: import('./context').ContextWindow | null }
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
  | { type: 'commands'; commands: import('./extensions').SkillCommand[] }
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

/** 后台任务（后台命令、多智能体编排、监视任务等） */
export interface BackgroundTask {
  id: string
  /** CLI 的任务类型：local_workflow / local_bash / local_agent / monitor … */
  kind: string
  description: string
  /** 最新进度（一句话），没有时为 null */
  message: string | null
}

/** 子智能体条上的一项 */
export interface SubagentStatus {
  id: string
  label: string
  /** running / completed / failed / stopped */
  status: string
  /** 最新进度（摘要或正在用的工具） */
  message: string | null
}

/** 智能体追踪里的一个智能体（编排里的智能体，或 Agent 工具派出的子智能体） */
export interface AgentRun {
  /** 还在排队的编排智能体可能还没有 id（空字符串） */
  id: string
  label: string
  /** 子智能体类型（general-purpose 等），编排智能体没有 */
  type: string
  model: string
  /** 原始状态词，界面统一归成 运行中 / 已完成 / 失败 / 已停止 / 排队中 */
  state: string
  /** 毫秒时间戳；不知道时为 0 */
  startedAt: number
  durationMs: number
  tokens: number
  toolCalls: number
  /** 所属阶段（编排智能体） */
  phase: number | null
  /** 任务说明的开头 */
  prompt: string
  /** 结果的开头 */
  result: string
  /** 派出它的工具调用 id（Agent 工具） */
  toolUseId: string | null
}

/** 一次多智能体编排（Workflow） */
export interface WorkflowRun {
  id: string
  name: string
  description: string
  status: string
  startedAt: number
  durationMs: number
  tokens: number
  toolCalls: number
  phases: { index: number; title: string }[]
  agents: AgentRun[]
  /** 启动它的工具调用 id（Workflow 工具） */
  toolUseId: string | null
}

export interface AgentRuns {
  workflows: WorkflowRun[]
  agents: AgentRun[]
}

/** 后台任务的输出（只给最后一段） */
export interface TaskOutput {
  output: string
  truncated: boolean
}

/** 一个会话在界面上需要的全部状态 */
export interface SessionSnapshot {
  commands?: import('./extensions').SkillCommand[]
  /** 最近主请求 / 引擎诊断，独立于计费累计用量。旧快照无此字段时为未知。 */
  context?: import('./context').ContextWindow | null
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

/** 一轮里一个模型的用量；四个 token 字段互不包含 */
export interface ModelTurnUsage {
  costSource?: import('./billing').CostSource
  billing?: import('./billing').BillingSource
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  /** 引擎报告的费用（美元）；不报告时为 null（例如 Codex） */
  costUsd: number | null
  /** 这一轮这个模型的请求次数 */
  requests?: number
}

/** 一轮的用量（docs/ui/usage.md §6.1） */
export interface TurnUsage {
  settlement?: import('./billing').PlatformSettlement
  /** 键是模型 id */
  models: Record<string, ModelTurnUsage>
  /** 这一轮总耗时（毫秒） */
  durationMs: number
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

export interface RequestCacheUsage {
  turnId: string
  messageId: string
  model: string
  input: number
  cacheRead: number
  cacheWrite: number
  observedAt: number
}

export interface RequestRetryState {
  turnId: string
  attempt: number | null
  maxRetries: number | null
  retryAt: number | null
  reason: string
}

export interface CacheWarning {
  sessionId: string
  turnId: string
  messageId: string
  title: string
  model: string
  input: number
  cached: number
  previousInput: number
  expiresAt: number
}

/** 新会话的默认设置：engine 是默认引擎，其余是这个引擎的默认值（会话里改过的选择也会记到所属引擎名下） */
export interface EngineDefaults extends SessionSettings {
  engine: EngineId
}

/** 每个引擎各自记的新会话默认值（设置 › 本机引擎 › 详情，docs/ui/engine-settings-redesign.md §3.2） */
export type SessionDefaults = Pick<SessionSettings, 'model' | 'effort' | 'permissionMode' | 'ultracode' | 'fast' | 'thinkingSummaries'>

/**
 * 每个引擎的本机配置（设置 › 本机引擎，docs/ui/plan-search-panes-compact.md §1、§3，engine-settings-redesign.md §3.2）：
 * - path：自定义可执行文件路径，覆盖自动查找
 * - env：在系统环境之上追加的环境变量（平台会话的网关变量仍然最后覆盖）
 * - compactModel：压缩上下文用的模型；null 表示跟随会话模型。目前只对平台会话生效
 * - defaults：新会话的默认值
 * - outputStyle：输出风格；null 表示跟随引擎自己的设置
 * - askQuestions：允许中途向用户提问（Claude 的 AskUserQuestion）；关掉时禁用这个工具
 * - autoCompactPct：上下文用到窗口的这个百分比时自动压缩；null 表示引擎内置阈值
 * - hidden：不在输入框的引擎菜单里显示（默认引擎不能隐藏）
 *
 * 除 defaults 外，改了对已开始的会话也生效：下一条消息开始前用新设置重启引擎进程并接上原对话。
 */
export interface EngineLocalConfig {
  path: string | null
  env: Record<string, string>
  compactModel: string | null
  defaults: SessionDefaults
  outputStyle: string | null
  askQuestions: boolean
  autoCompactPct: number | null
  hidden: boolean
}

export type EngineConfig = Record<EngineId, EngineLocalConfig>

export type EngineConfigPatch = Partial<Omit<EngineLocalConfig, 'defaults'>> & { defaults?: Partial<SessionDefaults> }

/** 引擎实际报上来的可选项（目前是输出风格），从引擎的初始化握手里读，读不到为空 */
export interface EngineCatalog {
  currentProvider?: string | null
  rateLimits?: unknown
  models?: EngineModel[]
  currentModel?: string | null
  authType?: string | null
  outputStyles: string[]
  /** 引擎自己的当前输出风格（不加我们的设置时） */
  currentOutputStyle: string | null
}

export interface EngineModel {
  id: string
  label: string
  efforts: Effort[]
  defaultEffort: Effort | null
  inputModalities: string[]
  isDefault: boolean
}

/** 检查更新的结果 */
export interface EngineUpdateResult {
  ok: boolean
  /** 引擎输出的最后几行，给用户看 */
  output: string
  /** 更新后重新检测到的版本 */
  version: string | null
}
