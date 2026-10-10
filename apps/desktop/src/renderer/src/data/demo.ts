// 演示数据的入口（AGENTS.md §5、docs/restructure.md §9.3）。
// 演示数据本身在 mock/，只由 main.tsx 在演示模式下动态加载后装进来；其它文件不导入 mock/，经 demo() 取用。
// 默认模式不加载 mock/（构建时它是单独的分块）。
import { useSyncExternalStore } from 'react'
import type {
  ArtifactResponse,
  ContextWindow,
  EngineCatalog,
  EngineConfig,
  FileChange,
  Item,
  RemoteCall,
  RewindPreview,
  SearchQuery,
  SearchResponse,
  SessionSnapshot,
  TaskOutput,
  UsageRecord,
} from '@pixelsky/protocol'
import type { AccountInfo } from '../../../shared/types/account'
import type { ArtifactPreview } from '../../../shared/types/artifacts'
import type { PlatformGroupInfo } from '../../../shared/types/platform-catalog'
import type { BrowserState } from '../../../shared/types/project-browser'
import type {
  EnvironmentState,
  GitBranch,
  GitDiff,
  GitStatus,
  ProjectCopy,
  TaskState,
} from '../../../shared/types/project-tools'
import type { TerminalProfile } from '../../../shared/types/terminal'
import type { DirectoryListing, EditorState, FileDocument } from '../../../shared/types/workspace'
import type { InboxItem } from '@/features/panel/inbox/inboxModel'
import type { AppData, DemoSessionChange, EngineLite } from './types'

/** 是否为演示模式（主进程根据环境变量 PIXELSKY_DEMO=1 或启动参数 --demo 传入） */
export const isDemo = typeof window !== 'undefined' && window.pixelsky?.demo === true

/** 演示模式下会话改动的内存存储（归档、删除、停止、改名、置底） */
export interface DemoSessions {
  get(): Record<string, DemoSessionChange>
  change(id: string, patch: Partial<DemoSessionChange>): void
  subscribe(listener: () => void): () => void
}

/** 全部演示数据。新增演示内容先在这里加字段，再在 mock/index.ts 填上 */
export interface DemoSource {
  /** 侧边栏、对话、输入框等界面数据（与 data/empty.ts 同形） */
  appData: AppData
  account: AccountInfo
  platformGroups: PlatformGroupInfo[]
  engines: { status: EngineLite[]; catalog: EngineCatalog; config: EngineConfig }
  artifacts: {
    response: ArtifactResponse
    change(itemId: string, path: string): FileChange | null
    preview(path: string): ArtifactPreview
  }
  context: ContextWindow
  files: {
    contents: Record<string, string>
    editorState: EditorState
    directory(path: string): DirectoryListing
    document(path: string): FileDocument
  }
  git: { status: GitStatus; branches: GitBranch[]; diff(path: string): GitDiff }
  inbox: InboxItem[]
  projectTools: { tasks: TaskState; environment: EnvironmentState; copies: ProjectCopy[]; browser: BrowserState }
  remoteCalls(now: number): RemoteCall[]
  usageRecords(now: number): UsageRecord[]
  search: { projects: Array<{ id: string; name: string }>; run(query: SearchQuery): SearchResponse }
  terminal: { profiles: TerminalProfile[]; output: string }
  sessions: DemoSessions
  /** 用真实对话组件显示的演示会话（docs/ui/demo-conversation.md）：会话快照、子智能体记录、后台任务输出 */
  conversations: {
    snapshots: Record<string, SessionSnapshot>
    subagentTranscript(sessionId: string, agentId: string): Item[]
    taskOutput(sessionId: string, taskId: string): TaskOutput
    /** 回退前的代码检查（docs/ui/rewind-fork-sidechat.md §1） */
    rewindPreview(sessionId: string, itemId: string, firstUserId: string | null): RewindPreview
    /** 旁聊回答（§3） */
    sideAnswer(question: string): string
  }
}

let source: DemoSource | null = null

/** 由 main.tsx 在演示模式下、界面加载之前调用一次 */
export function installDemo(demo: DemoSource): void {
  source = demo
}

/** 演示数据；只在 isDemo 为真的分支里调用 */
export function demo(): DemoSource {
  if (!source) throw new Error('演示数据还没有加载')
  return source
}

const NO_CHANGES: Record<string, DemoSessionChange> = {}
const noSubscribe = (): (() => void) => () => {}
const noChanges = (): Record<string, DemoSessionChange> => NO_CHANGES

/** 演示模式下的会话改动；不是演示模式时始终是空对象 */
export function useDemoSessionChanges(): Record<string, DemoSessionChange> {
  const sessions = source?.sessions
  return useSyncExternalStore(sessions?.subscribe ?? noSubscribe, sessions?.get ?? noChanges)
}

/** 当前的演示会话改动（非 hook）；不是演示模式时是空对象 */
export function demoSessionChanges(): Record<string, DemoSessionChange> {
  return source?.sessions.get() ?? NO_CHANGES
}
