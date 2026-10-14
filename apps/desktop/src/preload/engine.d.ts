// 引擎系统：主进程、预加载脚本、渲染进程共用的接口类型。规格见 docs/engines.md §5.1

import type {
  ApprovalDecision,
  EngineCatalog,
  EngineConfig,
  EngineConfigPatch,
  EngineDefaults,
  EngineId,
  EngineInfo,
  EngineUpdateResult,
  HostEvent,
  Item,
  MessageInput,
  SendReceipt,
  SearchQuery,
  SearchResponse,
  OpenedSession,
  ProjectRecord,
  AddProjectsResult,
  SessionRecord,
  SessionSettings,
  SessionSummary,
  TaskOutput,
  UsagePage,
  UsageSummary,
} from '@pixelsky/protocol'
import type { UsageQuery, SessionPatch } from '../shared/types/engine'
import type { ImportCandidates } from '../shared/types/workspace'

export interface EngineBridge {
  search(query: SearchQuery): Promise<SearchResponse>
  cancelSearch(requestId: number): Promise<void>
  /** 各引擎的本机配置：路径、环境变量、压缩模型、新会话默认值、输出风格等（设置 › 本机引擎） */
  config(): Promise<EngineConfig>
  setConfig(engine: EngineId, patch: EngineConfigPatch): Promise<EngineConfig>
  /** 设为默认引擎，返回新的默认设置 */
  setDefaultEngine(engine: EngineId): Promise<EngineDefaults>
  /** 引擎实际报上来的可选项（输出风格）；不发消息 */
  catalog(engine: EngineId, force?: boolean): Promise<EngineCatalog>
  /** 检查更新（Claude Code：claude update），结束后重新检测 */
  updateEngine(engine: EngineId): Promise<EngineUpdateResult>
  /** 一键安装（只在 EngineInfo.installable 时可用）；过程看 engine:event 的 engine_job */
  installEngine(engine: EngineId): Promise<EngineUpdateResult>
  retrySettings(): Promise<{ maxRetries: number | null }>
  setRetrySettings(maxRetries: number | null): Promise<{ maxRetries: number | null }>
  /** 引擎列表和状态；force 时重新检测 */
  engines(force?: boolean): Promise<EngineInfo[]>
  /** 新会话的默认设置 */
  defaults(): Promise<EngineDefaults>
  projects(): Promise<ProjectRecord[]>
  /** 弹出选择文件夹对话框（可以一次选几个）并添加项目；取消时返回 null */
  addProject(): Promise<AddProjectsResult | null>
  /** 按路径一次加多个项目（「从一个文件夹导入」、拖到侧栏的文件夹） */
  addProjects(paths: string[]): Promise<AddProjectsResult>
  /** 选一个上级文件夹，列出它下面的子文件夹；取消时返回 null */
  importCandidates(): Promise<ImportCandidates | null>
  removeProject(id: string): Promise<void>
  /** 只改显示名，磁盘上的文件夹不变 */
  renameProject(id: string, name: string): Promise<ProjectRecord>
  sessions(): Promise<SessionSummary[]>
  createSession(
    opts: {
      projectId: string
      engine?: EngineId
      copyId?: string | null
      workspaceSessionId?: string
    } & Partial<SessionSettings>,
  ): Promise<SessionRecord>
  /** 打开会话：返回快照和序号，之后只应用 onEvent 里序号更大的会话事件 */
  openSession(id: string): Promise<OpenedSession>
  /** 只取最后一段条目（手机端用，docs/mobile-remote.md §5.2） */
  openSessionTail(
    id: string,
    opts?: { limit?: number; before?: string },
  ): Promise<import('../shared/types/mobile').SessionTail>
  /** 一条的完整内容；会话或条目不存在时为 null */
  itemDetail(id: string, itemId: string): Promise<import('../shared/types/mobile').ItemDetail | null>
  send(id: string, input: string | MessageInput): Promise<SendReceipt>
  /** summary：最近请求加本地估算，不调接口；full（默认）：调 Token 计数接口 */
  context(
    id: string,
    detail?: import('@pixelsky/protocol').ContextDetailLevel,
  ): Promise<import('@pixelsky/protocol').ContextDiagnostic>
  compact(id: string): Promise<SendReceipt>
  cancelQueued(id: string, queueId: string): Promise<string>
  moveQueued(id: string, queueId: string, toIndex: number): Promise<void>
  runQueuedNow(id: string, queueId: string): Promise<void>
  steerQueued(id: string, queueId: string, expectedTurnId: string): Promise<void>
  resumeQueue(id: string): Promise<void>
  /** 回退前检查代码：要还原哪些文件（docs/ui/rewind-fork-sidechat.md §1） */
  rewindPreview(id: string, itemId: string): Promise<import('@pixelsky/protocol').RewindPreview>
  /** 回退到这条用户消息之前（对话和 / 或代码），回退对话时返回它的原文和图片 */
  rewind(
    id: string,
    itemId: string,
    options?: import('@pixelsky/protocol').RewindOptions,
  ): Promise<import('@pixelsky/protocol').RewindResult>
  /** 撤销最近一次回退 */
  undoRewind(id: string): Promise<void>
  /** 从这条用户消息之前分叉出新会话（§2） */
  fork(id: string, itemId: string, title?: string): Promise<import('@pixelsky/protocol').ForkResult>
  /** 旁聊：单独问一次，不进主对话（§3） */
  sideQuestion(id: string, question: string, history: import('@pixelsky/protocol').SideTurn[]): Promise<string>
  cancelSideQuestion(id: string): Promise<void>
  /** opts.background：连同后台子智能体一起停 */
  interrupt(id: string, opts?: import('@pixelsky/protocol').InterruptOptions): Promise<void>
  /** 提醒专用：轮次已过期时返回 false，不中断或暂停下一轮。 */
  interruptTurn(id: string, expectedTurnId: string): Promise<boolean>
  answer(id: string, requestId: string, decision: ApprovalDecision): Promise<void>
  updateSession(id: string, patch: SessionPatch): Promise<SessionRecord>
  deleteSession(id: string): Promise<void>
  archiveSession(id: string, archived: boolean, stopRunning?: boolean): Promise<void>
  renameSession(id: string, title: string): Promise<SessionRecord>
  setSessionBottom(id: string, bottomed: boolean): Promise<SessionRecord>
  setSessionPinned(id: string, pinned: boolean): Promise<SessionRecord>
  /** 停止一个后台任务 */
  stopTask(id: string, taskId: string): Promise<void>
  /** 读一个后台任务的输出（最后一段） */
  taskOutput(id: string, taskId: string): Promise<TaskOutput>
  /** 智能体追踪：读一个子智能体的对话（只读） */
  subagentTranscript(id: string, agentId: string): Promise<Item[]>
  /** 用量汇总（docs/ui/usage.md §6.3）；tzOffset 目前没用到，按主进程本地时区计算 */
  usageSummary(q: UsageQuery & { now: number; tzOffset?: number }): Promise<UsageSummary>
  /** 用量明细，最新在前，分页 */
  usageList(q: UsageQuery & { now: number; offset: number; limit: number }): Promise<UsagePage>
  /** 弹出保存对话框导出 CSV；取消时返回 false */
  usageExport(q: UsageQuery & { now: number }): Promise<boolean>
  usageClear(): Promise<void>
  /** 订阅主进程广播的事件；返回取消订阅函数 */
  onEvent(cb: (e: HostEvent) => void): () => void
}
