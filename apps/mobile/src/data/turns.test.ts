import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import {
  dividerText,
  latestTodo,
  processLine,
  retryNoticeId,
  stepCount,
  stepTitle,
  thinkingLabel,
  timeDividers,
  turnDuration,
} from './turns'

const user = (id: string): Item => ({ kind: 'user', id, text: id, createdAt: 0 })

const say = (id: string): Item => ({ kind: 'assistant', id, text: id, status: 'completed' })
const cmd = (id: string, description: string | null = null): Item =>
  ({ kind: 'command', id, command: 'ls', description, output: '', exitCode: 0, status: 'completed' }) as Item
const think = (id: string, text = 'hmm'): Item => ({ kind: 'reasoning', id, text, status: 'completed' })

describe('turnDuration / stepTitle', () => {
  it('formats the turn duration from stats', () => {
    const stats = {
      kind: 'turn_stats',
      id: 's1',
      turnId: 't',
      outcome: 'completed',
      usage: { models: {}, durationMs: 75_000 },
    } as Extract<Item, { kind: 'turn_stats' }>
    expect(turnDuration(stats)).toBe('用时 1 分 15 秒')
    expect(turnDuration(null)).toBe('')
  })

  it('titles a step', () => {
    expect(stepTitle(cmd('x', '列出文件'))).toBe('列出文件')
    expect(stepTitle(cmd('x'))).toBe('ls')
  })
})

describe('stepCount', () => {
  it('counts main-agent commands and tools, not thinking or empty process', () => {
    expect(stepCount([think('a', ' '), cmd('b'), cmd('c')])).toBe(2)
    expect(stepCount([])).toBe(0)
  })
})

describe('retryNoticeId', () => {
  const error = (id: string): Item => ({ kind: 'notice', id, level: 'error', text: '出错了' })
  const warn = (id: string): Item => ({ kind: 'notice', id, level: 'warn', text: '注意' })

  it('gives the last error of the latest turn, only when idle with an empty queue', () => {
    const items = [user('u1'), error('e1'), say('a1'), error('e2'), warn('w1')]
    expect(retryNoticeId(items, false, 0)).toBe('e2')
    expect(retryNoticeId(items, true, 0)).toBeNull()
    expect(retryNoticeId(items, false, 1)).toBeNull()
  })

  it('ignores errors from earlier turns', () => {
    expect(retryNoticeId([user('u1'), error('e1'), user('u2'), say('a2')], false, 0)).toBeNull()
    expect(retryNoticeId([], false, 0)).toBeNull()
  })
})

describe('processLine', () => {
  const edit = (id: string, path: string, added: number, removed: number, subagent?: string): Item =>
    ({
      kind: 'file_change',
      id,
      changes: [{ path, kind: 'update', diff: '', added, removed }],
      status: 'completed',
      subagent,
    }) as Item
  const tool = (id: string, kind: string, extra: object = {}): Item =>
    ({ kind: 'tool', id, tool: kind, name: 'X', status: 'completed', ...extra }) as unknown as Item

  it('counts main-agent steps and sums +/- over changed files', () => {
    const line = processLine([think('r'), cmd('c1'), edit('e1', 'a.ts', 30, 2), edit('e2', 'b.ts', 10, 10)])
    expect(line).toBe('做了 3 步 · 改了 2 个文件 +40 −12')
  })

  it('counts subagents separately and ignores their inner steps', () => {
    const line = processLine([tool('t1', 'task'), { ...cmd('c1'), subagent: 'A' } as Item, cmd('c2')])
    expect(line).toBe('做了 1 步 · 1 个子智能体')
  })

  it('ignores info notices, todos and empty thinking; reports failures', () => {
    const info: Item = { kind: 'notice', id: 'n', level: 'info', text: 'hi' }
    const todo: Item = { kind: 'todo', id: 'd', steps: [], status: 'completed' }
    const bad = { ...cmd('c1'), status: 'failed' } as Item
    expect(processLine([info, todo, think('r', ' ')])).toBe('')
    expect(processLine([info, bad, cmd('c2')])).toBe('做了 2 步 · 1 步失败')
  })
})

describe('timeDividers', () => {
  const T0 = new Date(2026, 9, 13, 14, 0, 0).getTime()
  const at = (id: string, createdAt: number, mode?: 'guidance'): Item => ({
    kind: 'user',
    id,
    text: id,
    createdAt,
    mode,
  })
  const stats = (durationMs?: number): Item =>
    ({ kind: 'turn_stats', id: 's', turnId: 't', outcome: 'completed', usage: { models: {}, durationMs } }) as Item
  const now = T0 + 3_600_000

  it('always marks the first turn, formats today as HH:mm', () => {
    expect([...timeDividers([at('u1', T0)], now)]).toEqual([['u1', '14:00']])
  })

  it('skips gaps of 5 minutes or less, marks longer ones', () => {
    const m = timeDividers([at('u1', T0), say('a'), at('u2', T0 + 300_000), at('u3', T0 + 300_000 + 300_001)], now)
    expect([...m.keys()]).toEqual(['u1', 'u3'])
  })

  it('counts the previous turn duration and ignores guidance', () => {
    const m = timeDividers(
      [at('u1', T0), stats(600_000), at('u2', T0 + 700_000), at('g', T0 + 5_000_000, 'guidance')],
      now,
    )
    expect([...m.keys()]).toEqual(['u1'])
  })

  it('formats yesterday, this year and older', () => {
    const n = new Date(2026, 9, 13, 9, 0).getTime()
    expect(dividerText(new Date(2026, 9, 12, 14, 32).getTime(), n)).toBe('昨天 14:32')
    expect(dividerText(new Date(2026, 8, 3, 8, 5).getTime(), n)).toBe('9月3日 08:05')
    expect(dividerText(new Date(2025, 11, 31, 23, 59).getTime(), n)).toBe('2025年12月31日 23:59')
  })
})

describe('thinkingLabel', () => {
  const run = (id: string, status: 'running' | 'completed', text = 'x'): Extract<Item, { kind: 'reasoning' }> => ({
    kind: 'reasoning',
    id,
    text,
    status,
  })

  it('tracks the span it saw running', () => {
    expect(thinkingLabel(run('k1', 'running'), 1000)).toBe('正在思考')
    expect(thinkingLabel(run('k1', 'running'), 3500)).toBe('思考中 3 秒')
    expect(thinkingLabel(run('k1', 'completed'), 5000)).toBe('思考了 4 秒')
    expect(thinkingLabel(run('k1', 'completed'), 99_000)).toBe('思考了 4 秒')
    expect(thinkingLabel(run('k2', 'running'), 0)).toBe('正在思考')
    expect(thinkingLabel(run('k2', 'completed'), 75_000)).toBe('思考了 1 分 15 秒')
  })

  it('has no time for history: text only, or hidden when empty', () => {
    expect(thinkingLabel(run('h1', 'completed'))).toBe('思考了')
    expect(thinkingLabel(run('h2', 'completed', ' '))).toBeNull()
  })

  it('prefers the engine-reported duration (Codex sends reasoning only after it is done)', () => {
    expect(thinkingLabel(run('c1', 'running'), 0)).toBe('正在思考')
    expect(thinkingLabel({ ...run('c1', 'completed', ''), durationMs: 6000 }, 20)).toBe('思考了 6 秒')
    expect(thinkingLabel({ ...run('c2', 'completed', ''), durationMs: 3000 })).toBe('思考了 3 秒')
  })
})

describe('latestTodo', () => {
  const todo = (id: string, statuses: ('pending' | 'in_progress' | 'completed')[]): Item => ({
    kind: 'todo',
    id,
    status: 'completed',
    steps: statuses.map((status, i) => ({ text: `s${i}`, status })),
  })

  it('reports progress of the latest todo and its current step', () => {
    const items = [todo('a', ['completed']), todo('b', ['completed', 'completed', 'in_progress', 'pending', 'pending'])]
    expect(latestTodo(items)).toEqual({ done: 2, at: 3, total: 5, current: 's2' })
  })

  it('shows the done count as the position when nothing is in progress', () => {
    expect(latestTodo([todo('a', ['completed', 'pending'])])).toEqual({ done: 1, at: 1, total: 2, current: null })
  })

  it('returns null without a todo or with empty steps', () => {
    expect(latestTodo([user('u')])).toBeNull()
    expect(latestTodo([todo('a', [])])).toBeNull()
  })
})
