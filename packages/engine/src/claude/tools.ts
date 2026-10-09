// Claude Code 的工具调用 → 统一条目（docs/engines.md §9「工具归类」）
import { isAbsolute, relative } from 'node:path'
import type { AlwaysScope, ApprovalRequest, FileChange, Item, ItemStatus, Question, TodoStep, ToolKind } from '@pixelsky/protocol'
import { diffAdded, diffFromHunks, diffText, type PatchHunk } from '../diff'
import { str } from './shape'

type Input = Record<string, unknown>


/** 输出最多保留这么多字符（头尾各一半），太长的命令输出不全放进内存和磁盘 */
const MAX_OUTPUT = 40_000

export function clip(text: string): string {
  if (text.length <= MAX_OUTPUT) return text
  const half = MAX_OUTPUT / 2
  return `${text.slice(0, half)}\n…（中间省略 ${text.length - MAX_OUTPUT} 个字符）…\n${text.slice(-half)}`
}

/** 工作目录里的文件显示相对路径 */
export function displayPath(p: string, cwd: string): string {
  if (!p) return p
  if (!isAbsolute(p)) return p
  const rel = relative(cwd, p)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.replace(/\\/g, '/') : p
}

const COMMAND_TOOLS = new Set(['Bash', 'PowerShell'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

function fileChangesFromInput(name: string, input: Input, cwd: string): FileChange[] {
  const path = displayPath(str(input.file_path) || str(input.notebook_path), cwd)
  if (name === 'Write') {
    const d = diffAdded(str(input.content))
    return [{ path, kind: 'add', newText: str(input.content).slice(0, MAX_OUTPUT), ...d }]
  }
  if (name === 'Edit') {
    const d = diffText(str(input.old_string), str(input.new_string))
    return [{ path, kind: 'update', newText: str(input.new_string).slice(0, MAX_OUTPUT), ...d }]
  }
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    const parts = (input.edits as Input[]).map((e) => diffText(str(e.old_string), str(e.new_string)))
    return [
      {
        path,
        kind: 'update',
        newText: str((input.edits as Input[])[0]?.new_string).slice(0, MAX_OUTPUT),
        diff: parts.map((p) => p.diff).join('\n'),
        added: parts.reduce((n, p) => n + p.added, 0),
        removed: parts.reduce((n, p) => n + p.removed, 0),
      },
    ]
  }
  return [{ path, kind: 'update', diff: '', added: 0, removed: 0 }]
}

function toolTitle(name: string, input: Input, cwd: string): { tool: ToolKind; title: string } {
  switch (name) {
    case 'Read':
      return { tool: 'read', title: displayPath(str(input.file_path), cwd) }
    case 'LS':
      return { tool: 'read', title: displayPath(str(input.path), cwd) }
    case 'Glob':
      return { tool: 'search', title: str(input.pattern) }
    case 'Grep':
      return { tool: 'search', title: [str(input.pattern), input.path ? displayPath(str(input.path), cwd) : ''].filter(Boolean).join(' · ') }
    case 'WebFetch':
      return { tool: 'web', title: str(input.url) }
    case 'WebSearch':
      return { tool: 'web', title: str(input.query) }
    case 'Task':
    case 'Agent':
      return { tool: 'task', title: str(input.description) || str(input.subagent_type) || '子任务' }
    case 'Workflow':
      return { tool: 'task', title: str(input.description) || str(input.name) || '多智能体编排' }
    case 'AskUserQuestion':
      return { tool: 'other', title: '向你提问' }
    case 'ExitPlanMode':
      return { tool: 'other', title: '提交计划' }
  }
  if (name.startsWith('mcp__')) {
    const [, server = '', tool = ''] = name.split('__')
    return { tool: 'mcp', title: `${server} · ${tool}` }
  }
  const brief = JSON.stringify(input)
  return { tool: 'other', title: brief.length > 80 ? `${brief.slice(0, 80)}…` : brief }
}

function todoSteps(input: Input): TodoStep[] {
  if (!Array.isArray(input.todos)) return []
  return (input.todos as Input[]).map((t) => ({
    text: str(t.content) || str(t.activeForm),
    status: t.status === 'completed' ? 'completed' : t.status === 'in_progress' ? 'in_progress' : 'pending',
  }))
}

/** 工具调用开始：模型给出了完整参数。subagent：调用它的子智能体名字（主智能体调用时不传） */
export function toolItem(id: string, name: string, input: Input, cwd: string, subagent?: string): Item {
  const item = baseToolItem(id, name, input, cwd)
  if (subagent && (item.kind === 'command' || item.kind === 'file_change' || item.kind === 'tool')) return { ...item, subagent }
  return item
}

function baseToolItem(id: string, name: string, input: Input, cwd: string): Item {
  if (COMMAND_TOOLS.has(name)) {
    return {
      kind: 'command',
      id,
      command: str(input.command),
      description: str(input.description) || null,
      output: '',
      exitCode: null,
      status: 'running',
    }
  }
  if (EDIT_TOOLS.has(name)) {
    return { kind: 'file_change', id, changes: fileChangesFromInput(name, input, cwd), status: 'running' }
  }
  if (name === 'TodoWrite') {
    return { kind: 'todo', id, steps: todoSteps(input), status: 'running' }
  }
  const { tool, title } = toolTitle(name, input, cwd)
  return { kind: 'tool', id, tool, name, title, output: '', status: 'running' }
}

/** tool_result 的 content：字符串，或 [{type:'text',text}, {type:'image',…}] */
export function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const b = c as Input
        if (b.type === 'text') return str(b.text)
        if (b.type === 'image') return '[图片]'
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** 工具调用结束：拿到 tool_result（以及 Claude 附带的结构化结果 tool_use_result） */
export function completeToolItem(item: Item, content: unknown, isError: boolean, structured: unknown, status?: ItemStatus): Item {
  const text = clip(resultText(content))
  const finalStatus: ItemStatus = status ?? (isError ? 'failed' : 'completed')
  const r = (structured && typeof structured === 'object' ? structured : {}) as Input
  switch (item.kind) {
    case 'command': {
      const stdout = str(r.stdout)
      const stderr = str(r.stderr)
      const output = stdout || stderr ? clip([stdout, stderr].filter(Boolean).join('\n')) : text
      return { ...item, output, status: finalStatus }
    }
    case 'file_change': {
      if (isError) return { ...item, status: finalStatus }
      const hunks = Array.isArray(r.structuredPatch) ? (r.structuredPatch as PatchHunk[]) : []
      if (item.changes.length === 1) {
        const [c] = item.changes
        if (r.type === 'create') {
          return { ...item, changes: [{ ...c, kind: 'add', ...diffAdded(str(r.content)) }], status: finalStatus }
        }
        if (hunks.length > 0) {
          return { ...item, changes: [{ ...c, kind: 'update', ...diffFromHunks(hunks) }], status: finalStatus }
        }
      }
      return { ...item, status: finalStatus }
    }
    case 'tool':
      return { ...item, output: text, status: finalStatus }
    case 'todo':
      return { ...item, status: finalStatus }
    default:
      return item
  }
}

function questionsFromInput(input: Input): Question[] {
  if (!Array.isArray(input.questions)) return []
  return (input.questions as Input[]).map((q) => ({
    question: str(q.question),
    header: str(q.header),
    multiSelect: q.multiSelect === true,
    options: Array.isArray(q.options)
      ? (q.options as Input[]).map((o) => ({ label: str(o.label), description: str(o.description) }))
      : [],
  }))
}

/** Claude Code 的「始终允许」能保存到的范围 */
export const CLAUDE_ALWAYS_SCOPES: AlwaysScope[] = ['session', 'project', 'user']

/** 范围 → updatedPermissions 的 destination */
const DESTINATION: Record<AlwaysScope, string> = { session: 'session', project: 'localSettings', user: 'userSettings' }

/**
 * 「始终允许」要回传的权限规则（参考 JuCode always_permissions）：
 * 取 CLI 建议里「添加允许规则」的那些，把保存位置换成所选范围；没有就允许整个工具。
 */
export function alwaysPermissions(toolName: string, suggestions: unknown[], scope: AlwaysScope): unknown[] {
  const destination = DESTINATION[scope]
  const rules = suggestions
    .map((x) => (x && typeof x === 'object' ? (x as Input) : {}))
    .filter((x) => x.type === 'addRules' && x.behavior === 'allow' && Array.isArray(x.rules))
    .map((x) => ({ ...x, destination }))
  return rules.length > 0 ? rules : [{ type: 'addRules', rules: [{ toolName }], behavior: 'allow', destination }]
}

/** can_use_tool 审批请求 → 统一审批卡片 */
export function approvalFor(
  requestId: string,
  toolName: string,
  input: Input,
  toolUseId: string | null,
  cwd: string,
): ApprovalRequest {
  const common = { requestId, itemId: toolUseId, alwaysScopes: CLAUDE_ALWAYS_SCOPES }
  if (COMMAND_TOOLS.has(toolName)) {
    return { ...common, kind: 'command', title: '运行命令', command: str(input.command), description: str(input.description) || undefined }
  }
  if (EDIT_TOOLS.has(toolName)) {
    const changes = fileChangesFromInput(toolName, input, cwd)
    return { ...common, kind: 'file_change', title: toolName === 'Write' ? '写入文件' : '修改文件', changes }
  }
  if (toolName === 'AskUserQuestion') {
    return { ...common, kind: 'question', title: 'Claude 想问你', questions: questionsFromInput(input), alwaysScopes: [] }
  }
  if (toolName === 'ExitPlanMode') {
    return { ...common, kind: 'plan', title: '计划已就绪，要开始执行吗？', plan: str(input.plan), alwaysScopes: [] }
  }
  const { title } = toolTitle(toolName, input, cwd)
  return { ...common, kind: 'tool', title: `使用 ${toolName}`, toolName, input, description: title }
}
