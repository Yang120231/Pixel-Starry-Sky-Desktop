// 待办工具 todo_write：模型用它维护任务清单（参照 Claude Code 的 TodoWrite）。
// 每次调用传入完整清单，替换旧的；最新清单保存在会话内存里，并放进结果 details 供界面渲染。
// 只用可擦除的 TS 语法。
import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

export const TODO_STATUSES = ['pending', 'in_progress', 'completed'] as const
export type TodoStatus = (typeof TODO_STATUSES)[number]

export interface TodoItem {
  content: string
  status: TodoStatus
  activeForm?: string
}

export type TodoValidation = { ok: true; todos: TodoItem[] } | { ok: false; error: string }

/** 校验并规范化待办清单（纯函数）。 */
export function validateTodos(value: unknown): TodoValidation {
  if (!Array.isArray(value)) return { ok: false, error: 'todos must be an array' }
  const todos: TodoItem[] = []
  for (let i = 0; i < value.length; i++) {
    const raw = value[i] as unknown
    if (!raw || typeof raw !== 'object') return { ok: false, error: `todos[${i}] must be an object` }
    const item = raw as Record<string, unknown>
    if (typeof item.content !== 'string' || item.content.trim() === '') {
      return { ok: false, error: `todos[${i}].content must be a non-empty string` }
    }
    if (typeof item.status !== 'string' || !(TODO_STATUSES as readonly string[]).includes(item.status)) {
      return { ok: false, error: `todos[${i}].status must be one of ${TODO_STATUSES.join(', ')}` }
    }
    if (item.activeForm !== undefined && (typeof item.activeForm !== 'string' || item.activeForm.trim() === '')) {
      return { ok: false, error: `todos[${i}].activeForm must be a non-empty string when provided` }
    }
    todos.push({
      content: item.content.trim(),
      status: item.status as TodoStatus,
      ...(typeof item.activeForm === 'string' ? { activeForm: item.activeForm.trim() } : {}),
    })
  }
  const inProgress = todos.filter(t => t.status === 'in_progress').length
  if (inProgress > 1) {
    return { ok: false, error: `at most one todo may be in_progress at a time (found ${inProgress})` }
  }
  return { ok: true, todos }
}

/** 一行概览，给模型的返回文字。 */
export function summarizeTodos(todos: readonly TodoItem[]): string {
  const count = (s: TodoStatus) => todos.filter(t => t.status === s).length
  const current = todos.find(t => t.status === 'in_progress')
  const head = `Todos updated: ${todos.length} total, ${count('completed')} completed, ${count('in_progress')} in progress, ${count('pending')} pending.`
  return current ? `${head} Current: ${current.activeForm ?? current.content}` : head
}

export const TODO_TOOL_NAME = 'todo_write'

const DESCRIPTION = `Create and manage a structured task list for the current coding session. It helps you track progress, organize complex tasks, and shows the user what you are working on.

Use it proactively for: tasks with 3 or more distinct steps, non-trivial multi-file changes, when the user gives several tasks, or when the user explicitly asks for a todo list. Skip it for a single trivial task or purely conversational requests.

Rules:
- Each call REPLACES the whole list: always send every todo, with updated statuses.
- Statuses: pending (not started), in_progress (working on it now), completed (finished).
- Keep exactly one todo in_progress while working; mark it completed immediately when done, before starting the next.
- Only mark completed when the work is fully done (tests pass, no unresolved errors); otherwise keep it in_progress and add a todo for the blocker.
- content is the imperative form ("Run tests"); activeForm is the present continuous form shown while it runs ("Running tests").`

/** 创建工具；清单保存在闭包里（会话内存）。 */
export function createTodoTool() {
  let latest: TodoItem[] = []
  const tool = {
    name: TODO_TOOL_NAME,
    label: 'Todo',
    description: DESCRIPTION,
    promptSnippet: 'Track a multi-step task list (todo_write)',
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          content: Type.String({ minLength: 1, description: 'Imperative description of the task' }),
          status: Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed')]),
          activeForm: Type.Optional(Type.String({ description: "Present continuous form, e.g. 'Running tests'" })),
        }),
        { description: 'The complete, updated todo list' },
      ),
    }),
    executionMode: 'sequential' as const,
    async execute(_toolCallId: string, params: { todos: unknown }) {
      const result = validateTodos(params.todos)
      if (!result.ok) throw new Error(`Invalid todos: ${result.error}`)
      latest = result.todos
      return {
        content: [{ type: 'text' as const, text: summarizeTodos(latest) }],
        details: { todos: latest },
      }
    },
  }
  return { tool, getTodos: (): readonly TodoItem[] => latest }
}

export const todoExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  const { tool } = createTodoTool()
  pi.registerTool(tool)
}
