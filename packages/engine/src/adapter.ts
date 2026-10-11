// 引擎适配器接口：每种引擎（Claude Code、以后的 Codex）实现一份，EngineHost 只认这个接口。
import type {
  AgentRuns,
  ApprovalDecision,
  ImageAttachment,
  Item,
  TaskOutput,
  EngineCatalog,
  EngineEvent,
  EngineInfo,
  EngineUpdateResult,
  PermissionMode,
  SessionRecord,
  SessionSettings,
} from '@pixelsky/protocol'

/** 要启动的程序：可执行文件 + 固定在前面的参数（例如用 node 跑 cli.js 时是 [cli.js]） */
export interface Launcher {
  command: string
  args: string[]
}

/** 适配器向 EngineHost 汇报的通道 */
export interface SessionContext {
  extensions?: import('@pixelsky/protocol').ExtensionLaunch
  /** 本轮的请求重试策略，创建会话连接时固定，null 跟随引擎。 */
  maxRetries?: number | null
  /** 当前的会话记录（cwd、设置、引擎会话 id 都从这里取最新值） */
  record(): SessionRecord
  /**
   * 条目、审批、用量、一轮结束等事件。
   * 适配器不发 status / record 事件：运行状态和会话记录由 EngineHost 维护。
   */
  emit(event: EngineEvent): void
  /** 引擎分配（或确认）了自己的会话 id */
  setEngineSessionId(id: string): void
  /** 引擎自己改了权限模式（例如计划模式下用户同意了计划） */
  setPermissionMode(mode: PermissionMode): void
  /** 引擎实际生效的 Ultracode 状态和我们记录的不一样（例如当前模型不支持） */
  setUltracode(on: boolean): void
  /** Fast 模式开不了（账号或接口不支持），把记录里的开关关掉 */
  setFast(on: boolean): void
  /** 回退截断点已在新进程生效 */
  clearPendingRewind?(): void
  /** 分叉第一次启动成功（或改成新会话）后清掉 pendingFork */
  clearPendingFork?(): void
}

/** 一个会话对应的引擎连接。进程按需启动；close() 之后这个对象不再使用 */
export interface EngineSession {
  /**
   * 开始新的一轮。EngineHost 已经发出了用户消息条目和 turn_started，
   * 适配器负责在这一轮结束时发 turn_completed（带同一个 turnId），出错也要发。
   */
  send(text: string, turnId: string, userItemId: string, attachments?: ImageAttachment[]): void
  interrupt(): Promise<void>
  answer(requestId: string, decision: ApprovalDecision): void
  /** 改模型 / 强度 / 权限 / 开关：进程在跑就实时生效，否则下次启动时生效 */
  update(patch: Partial<SessionSettings>, strict?: boolean): Promise<void>
  steer?(text: string, userItemId: string, attachments?: ImageAttachment[]): Promise<void>
  /**
   * 上下文明细。flags.contextLive 时运行中也可调用；否则仅宿主确认会话空闲后调用。
   * summary 用最近请求的计数加本地估算，full 调 Token 计数接口。
   */
  context?(
    detail?: import('@pixelsky/protocol').ContextDetailLevel,
  ): Promise<import('@pixelsky/protocol').ContextDiagnostic>
  /** 停止一个后台任务；没有后台任务的引擎不实现（caps.backgroundTasks 为 false） */
  stopTask?(taskId: string): Promise<void>
  /** 读一个后台任务的输出（只给最后一段）；没有后台任务的引擎不实现 */
  taskOutput?(taskId: string): Promise<TaskOutput>
  close(): Promise<void>
}

export interface EngineAdapter {
  /** 检测引擎状态；结果会缓存，force 时重新检测 */
  info(force?: boolean): Promise<EngineInfo>
  /**
   * 保存前校验用户替换的命令和追加的参数（docs/ui/engine-launch.md §3）：命令找不到、不能直接启动，
   * 或参数里有像素星空自己控制的参数时抛出原因。command 为 null 时不查命令。
   */
  checkLaunch?(command: string | null, args: readonly string[]): void
  createSession(ctx: SessionContext): EngineSession
  /** 智能体追踪：从引擎保存的文件读出这个会话以前的编排和子智能体（不需要进程在跑） */
  loadRuns?(record: SessionRecord): AgentRuns
  /** 智能体追踪：读一个子智能体的对话（只读） */
  subagentTranscript?(record: SessionRecord, agentId: string): Item[] | Promise<Item[]>
  /** 引擎实际报上来的可选项（输出风格等）；不发消息、不花钱，force 时不用缓存 */
  catalog?(force?: boolean): Promise<EngineCatalog>
  /** 检查更新并安装（Claude Code：claude update；Codex：npm install -g）；宿主随后重新检测 */
  update?(): Promise<EngineUpdateResult>
  /** npm 上的包名：宿主定时查最新版本，界面提示「有新版本」（docs/ui/engine-update.md） */
  readonly npmPackage?: string
  /**
   * 更新要替换正在用的程序（Windows 上 npm 换不了被占用的 codex.exe）：宿主先关掉这个引擎空闲的进程，
   * 有任务在跑就不更新
   */
  readonly updateNeedsIdle?: boolean
  /**
   * 回退：按要移除的用户消息（按顺序）在引擎记录里找截断点。
   * 返回 null 表示这些消息都没进入引擎上下文；at 为 null 表示回到会话开头（换新的引擎会话）。
   */
  rewindAnchor?(record: SessionRecord, userItemIds: string[]): { at: string | null } | null
  /** 回退恢复代码：预览或还原到这条用户消息之前的文件（docs/ui/rewind-fork-sidechat.md §1） */
  rewindFiles?(record: SessionRecord, userItemId: string, dryRun: boolean): Promise<RewindFilesReply>
  /** 旁聊：带着会话上下文单独问一次，没有工具、不写记录（§3） */
  sideQuestion?(record: SessionRecord, prompt: string, signal: AbortSignal): Promise<string>
}

/** 恢复代码的结果；files 是绝对路径 */
export type RewindFilesReply =
  | { ok: true; files: string[]; insertions: number; deletions: number }
  | { ok: false; reason: 'no-checkpoint' | 'failed'; message: string }
