import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@pixelsky/protocol'
import { reminders } from './notify'

const s = (id: string, state: string, extra: Record<string, unknown> = {}) =>
  ({
    record: { id, title: `任务${id}`, updatedAt: 1, lastOutcome: null, ...extra },
    state,
  }) as unknown as SessionSummary

describe('reminders', () => {
  it('stays quiet on the first list', () => {
    expect(reminders(null, [s('a', 'waiting')])).toEqual([])
  })

  it('reminds when a task starts waiting, finishes or fails', () => {
    const prev = [s('a', 'running'), s('b', 'running'), s('c', 'running'), s('d', 'idle'), s('e', 'waiting')]
    const next = [
      s('a', 'waiting'),
      s('b', 'idle', { lastOutcome: 'completed' }),
      s('c', 'idle', { lastOutcome: 'failed', lastError: '额度不足' }),
      s('d', 'idle'),
      s('e', 'waiting'),
    ]
    expect(reminders(prev, next)).toEqual([
      { kind: 'waiting', sessionId: 'a', title: '等你处理', body: '任务a' },
      { kind: 'completed', sessionId: 'b', title: '任务完成', body: '任务b' },
      { kind: 'failed', sessionId: 'c', title: '任务出错了', body: '任务c：额度不足' },
    ])
  })

  it('does not remind for stopped or archived tasks', () => {
    expect(reminders([s('a', 'running')], [s('a', 'idle', { lastOutcome: 'interrupted' })])).toEqual([])
    expect(reminders([s('a', 'running')], [s('a', 'waiting', { archivedAt: 5 })])).toEqual([])
  })
})
