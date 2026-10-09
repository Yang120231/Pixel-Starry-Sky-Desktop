import type { ImageAttachment, TurnOutcome } from './session'
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
