import { describe, expect, it } from 'vitest'
import { createTodoTool, summarizeTodos, validateTodos } from '../src/tools/todo.ts'

describe('validateTodos', () => {
  it('接受合法清单并整理空白', () => {
    const r = validateTodos([
      { content: ' Run tests ', status: 'in_progress', activeForm: 'Running tests' },
      { content: 'Ship', status: 'pending' },
      { content: 'Plan', status: 'completed' },
    ])
    expect(r).toEqual({
      ok: true,
      todos: [
        { content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' },
        { content: 'Ship', status: 'pending' },
        { content: 'Plan', status: 'completed' },
      ],
    })
  })

  it('空清单合法（清空）', () => {
    expect(validateTodos([])).toEqual({ ok: true, todos: [] })
  })

  it('拒绝非数组、空内容、非法状态、空 activeForm', () => {
    expect(validateTodos('x').ok).toBe(false)
    expect(validateTodos([null]).ok).toBe(false)
    expect(validateTodos([{ content: '  ', status: 'pending' }]).ok).toBe(false)
    expect(validateTodos([{ content: 'a', status: 'done' }]).ok).toBe(false)
    expect(validateTodos([{ content: 'a', status: 'pending', activeForm: '' }]).ok).toBe(false)
  })

  it('同时只能有一个 in_progress', () => {
    const r = validateTodos([
      { content: 'a', status: 'in_progress' },
      { content: 'b', status: 'in_progress' },
    ])
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('in_progress')
  })
})

describe('todo_write 工具', () => {
  it('保存最新清单并返回概览，每次替换', async () => {
    const { tool, getTodos } = createTodoTool()
    const r1 = await tool.execute('1', {
      todos: [
        { content: 'A', status: 'completed' },
        { content: 'B', status: 'in_progress', activeForm: 'Doing B' },
        { content: 'C', status: 'pending' },
      ],
    })
    expect(r1.content[0].text).toContain('3 total, 1 completed, 1 in progress, 1 pending')
    expect(r1.content[0].text).toContain('Current: Doing B')
    expect(getTodos()).toHaveLength(3)
    await tool.execute('2', { todos: [{ content: 'D', status: 'pending' }] })
    expect(getTodos()).toEqual([{ content: 'D', status: 'pending' }])
  })

  it('非法输入抛错且不改动已保存的清单', async () => {
    const { tool, getTodos } = createTodoTool()
    await tool.execute('1', { todos: [{ content: 'A', status: 'pending' }] })
    await expect(tool.execute('2', { todos: [{ content: '', status: 'pending' }] })).rejects.toThrow(/Invalid todos/)
    expect(getTodos()).toHaveLength(1)
  })

  it('summarizeTodos 没有进行中项时不带 Current', () => {
    expect(summarizeTodos([{ content: 'A', status: 'pending' }])).not.toContain('Current')
  })
})
