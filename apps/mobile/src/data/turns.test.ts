import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { groupTurns, processSummary, stepTitle, turnDuration } from './turns'

const user = (id: string): Item => ({ kind: 'user', id, text: id, createdAt: 0 })
const say = (id: string): Item => ({ kind: 'assistant', id, text: id, status: 'completed' })
const cmd = (id: string, description: string | null = null): Item =>
  ({ kind: 'command', id, command: 'ls', description, output: '', exitCode: 0, status: 'completed' }) as Item
const think = (id: string, text = 'hmm'): Item => ({ kind: 'reasoning', id, text, status: 'completed' })

describe('groupTurns', () => {
  it('splits by user message and separates process from output', () => {
    const stats = {
      kind: 'turn_stats',
      id: 's1',
      turnId: 't',
      outcome: 'completed',
      usage: { models: {}, durationMs: 75_000 },
    } as Item
    const turns = groupTurns([
      say('intro'),
      user('u1'),
      think('r1'),
      cmd('c1'),
      say('a1'),
      stats,
      user('u2'),
      say('a2'),
    ])
    expect(turns.map(t => [t.user?.id ?? null, t.process.map(i => i.id), t.output.map(i => i.id)])).toEqual([
      [null, [], ['intro']],
      ['u1', ['r1', 'c1'], ['a1']],
      ['u2', [], ['a2']],
    ])
    expect(turnDuration(turns[1].stats)).toBe('用时 1 分 15 秒')
  })

  it('summarises steps without empty thinking', () => {
    expect(processSummary([think('a', ' '), cmd('b'), cmd('c')])).toBe('已执行 2 步')
    expect(processSummary([])).toBe('')
    expect(stepTitle(cmd('x', '列出文件'))).toBe('列出文件')
    expect(stepTitle(cmd('x'))).toBe('ls')
  })
})
