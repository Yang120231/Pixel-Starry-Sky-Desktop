// 模型给的工具参数形状不对时不能抛错（审查报告 2026-10-14：数组里有 null 时在 stdout 回调里抛出未捕获异常）
import { describe, expect, it } from 'vitest'
import { approvalFor, toolItem } from '../src/claude/tools'

describe('工具参数里的数组有 null / 非对象元素', () => {
  it('MultiEdit 的 edits', () => {
    const input = { file_path: 'D:/w/a.ts', edits: [null, 1, { old_string: 'a', new_string: 'b' }] }
    expect(() => toolItem('m', 'MultiEdit', input, 'D:/w')).not.toThrow()
    expect(() => approvalFor('r', 'MultiEdit', input, 'm', 'D:/w')).not.toThrow()
  })
  it('TodoWrite 的 todos', () => {
    expect(() =>
      toolItem('t', 'TodoWrite', { todos: [null, { content: 'x', status: 'pending' }] }, 'D:/w'),
    ).not.toThrow()
  })
  it('AskUserQuestion 的 questions 和 options', () => {
    const input = { questions: [null, { question: 'q', options: [null, { label: 'a' }] }] }
    expect(() => toolItem('q', 'AskUserQuestion', input, 'D:/w')).not.toThrow()
    expect(() => approvalFor('r', 'AskUserQuestion', input, 'q', 'D:/w')).not.toThrow()
  })
})
