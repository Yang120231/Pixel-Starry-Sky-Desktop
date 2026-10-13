import type { FileAttachment, ImageAttachment, TurnOutcome } from './session'
import type { TurnUsage } from './usage'

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
  | {
      kind: 'user'
      id: string
      text: string
      attachments?: ImageAttachment[]
      /** 带的文本文件（text 是用户写的话，不含文件内容） */
      files?: FileAttachment[]
      createdAt: number
      turnId?: string
      mode?: 'normal' | 'guidance'
    }
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
      /** 派出这个子智能体的 Agent 工具调用 id（对应智能体追踪的 AgentRun.toolUseId，docs/ui/subagent-changes.md §2.3） */
      subagentCall?: string
      /** 后台子智能体的工具：这一轮结束时还在跑，不跟着这一轮收尾 */
      background?: boolean
    }
  | {
      kind: 'file_change'
      id: string
      changes: FileChange[]
      status: ItemStatus
      subagent?: string
      subagentCall?: string
      background?: boolean
    }
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
      subagentCall?: string
      background?: boolean
      /** 结果里的图片（例如 Read 了一张图片），有大小上限；超出的只在 output 里留「[图片]」 */
      images?: ImageAttachment[]
    }
  | { kind: 'todo'; id: string; steps: TodoStep[]; status: ItemStatus }
  /** detail：引擎给出的原始报错详情（附加说明、错误类型、HTTP 状态码等），界面默认折叠 */
  | { kind: 'notice'; id: string; level: 'info' | 'warn' | 'error'; text: string; detail?: string | null }
  /**
   * 压缩上下文（docs/ui/compaction.md）：进行中显示动画和计时，结束后显示「压缩前 → 压缩后」和用时。
   * trigger：手动 /compact 还是自动；引擎没说时为 null。几个大小、用时拿不到时为 null
   */
  | {
      kind: 'compaction'
      id: string
      status: ItemStatus
      trigger: 'manual' | 'auto' | null
      startedAt: number
      durationMs: number | null
      preTokens: number | null
      postTokens: number | null
      error?: string | null
    }
  /** 一轮结束后的统计（耗时、token、费用、模型），显示在这一轮回复下方（docs/ui/usage.md §4） */
  | { kind: 'turn_stats'; id: string; turnId: string; outcome: TurnOutcome; usage: TurnUsage }

export type ItemKind = Item['kind']
