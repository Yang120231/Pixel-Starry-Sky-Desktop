// EngineHost 各模块共享的状态，以及模块之间互相调用的入口（docs/restructure.md §8.3 P8）。
// 模块只在方法调用时经 ctx.m 访问别的模块，不在构造时互相取值。
import type {
  EngineId,
  ExtensionLaunch,
  HostEvent,
  PlatformCharge,
  PlatformSettlement,
  SendReceipt,
  SessionRecord,
  SessionSnapshot,
} from '@pixelsky/protocol'
import type { EngineAdapter, EngineSession } from '../adapter'
import type { Store } from '../store'
import type { UsageStore } from '../usage'
import type { HostCache } from './cache'
import type { HostEvents } from './events'
import type { HostBranch } from './branch'
import type { HostGuard } from './guard'
import type { HostProjects } from './projects'
import type { HostQuery } from './query'
import type { HostQueue } from './queue'
import type { HostSessions } from './sessions'
import type { HostSettings } from './settings'
import type { HostTurn } from './turn'
import type { HostUsage } from './usage'

export interface EngineHostOptions {
  platformCharges?: (settlement: PlatformSettlement, signal: AbortSignal) => Promise<PlatformCharge[]>
  settlementDelays?: number[]
  /** 按项目准备插件 / MCP 配置；返回的临时资源由引擎连接关闭时释放。 */
  extensions?: (record: SessionRecord) => ExtensionLaunch
  /** 宿主为单个会话提供平台代理环境，空值使用本机认证。 */
  sessionEnv?: (record: SessionRecord) => NodeJS.ProcessEnv
  /** 保存数据的目录（Electron 里是 userData/engine） */
  dataDir: string
  /** 广播事件给界面 */
  emit(event: HostEvent): void
  /** 空闲多久关闭引擎进程，默认 30 分钟 */
  idleMs?: number
  /** 测试用：替换适配器 */
  adapters?: Partial<Record<EngineId, EngineAdapter>>
  /** 平台认证 / 路由预检；排队时只保存身份，执行前重新验证。 */
  validateInput?: (record: SessionRecord) => Promise<void>
}

export interface Runtime {
  inspectingContext?: boolean
  sessionMaxRetries: number | null | undefined
  snapshot: SessionSnapshot
  /** 事件序号，每应用一个事件加一（见 OpenedSession） */
  seq: number
  session: EngineSession | null
  idleTimer: NodeJS.Timeout | null
  receipts: SendReceipt[]
  pumping: boolean
  stopping: boolean
  generation: number
  activeId: string | null
  execution: SessionRecord | null
  sessionSource: string | null | undefined
  /** 启动这个进程时的引擎级设置（launchKey）；设置变了，下一条消息前重启进程 */
  sessionLaunch?: string
  pumpFinished: Promise<void> | null
}

export interface HostModules {
  guard: HostGuard
  settings: HostSettings
  projects: HostProjects
  query: HostQuery
  cache: HostCache
  usage: HostUsage
  events: HostEvents
  queue: HostQueue
  turn: HostTurn
  sessions: HostSessions
  branch: HostBranch
}

export interface HostContext {
  readonly opts: EngineHostOptions
  readonly store: Store
  readonly usage: UsageStore
  readonly idleMs: number
  /** 构造时赋值一次（自带的适配器要读设置模块） */
  adapters: Partial<Record<EngineId, EngineAdapter>>
  readonly records: Map<string, SessionRecord>
  readonly runtimes: Map<string, Runtime>
  readonly changingSessions: Set<string>
  readonly lockedWorkspaces: Set<string>
  /** 应用正在退出；异步任务每次都读最新值 */
  closing: boolean
  /** 各模块，构造完成后赋值 */
  m: HostModules
}
