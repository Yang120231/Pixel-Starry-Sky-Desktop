import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSummary } from '@pixelsky/protocol'
import { PushScheduler, pushChanges, pushPayload } from './push'

const s = (id: string, state: string, lastOutcome: string | null = null, archivedAt: number | null = null) =>
  ({ record: { id, title: id, updatedAt: 1, archivedAt, lastOutcome }, state }) as unknown as SessionSummary

describe('pushChanges', () => {
  it('counts sessions that start waiting, and running ones that finish or fail', () => {
    const prev = [
      s('a', 'running'),
      s('b', 'running'),
      s('c', 'idle'),
      s('d', 'starting'),
      s('e', 'waiting'),
      s('f', 'running'),
    ]
    const next = [
      s('a', 'idle', 'completed'),
      s('b', 'idle', 'failed'),
      s('c', 'waiting'),
      s('d', 'idle', 'completed'),
      s('e', 'waiting'),
      s('f', 'waiting'),
    ]
    expect(pushChanges(prev, next)).toEqual({ waiting: 2, failed: 1, completed: 2 })
  })

  it('does not count sessions that show up already waiting (a remote machine reconnecting)', () => {
    expect(pushChanges([s('a', 'running')], [s('a', 'running'), s('r', 'waiting')])).toEqual({
      waiting: 0,
      failed: 0,
      completed: 0,
    })
  })

  it('ignores the first list, archived sessions and sessions that were already idle', () => {
    expect(pushChanges(null, [s('a', 'waiting')])).toEqual({ waiting: 0, failed: 0, completed: 0 })
    expect(pushChanges([s('a', 'running')], [s('a', 'waiting', null, 5)])).toEqual({
      waiting: 0,
      failed: 0,
      completed: 0,
    })
    expect(pushChanges([s('a', 'idle')], [s('a', 'idle', 'completed')])).toEqual({
      waiting: 0,
      failed: 0,
      completed: 0,
    })
  })
})

describe('pushPayload', () => {
  it('picks the most urgent kind and caps the count', () => {
    expect(pushPayload({ waiting: 0, failed: 0, completed: 0 })).toBeNull()
    expect(pushPayload({ waiting: 0, failed: 1, completed: 3 })).toEqual({ kind: 'failed', count: 1 })
    expect(pushPayload({ waiting: 200, failed: 1, completed: 3 })).toEqual({ kind: 'waiting', count: 99 })
  })
})

describe('PushScheduler', () => {
  afterEach(() => vi.useRealTimers())

  it('adds up what arrives within the delay into one push per phone, and can be cancelled', async () => {
    vi.useFakeTimers()
    const sent: string[] = []
    const scheduler = new PushScheduler(async (phone, p) => void sent.push(`${phone} ${p.kind} ${p.count}`), 2000)
    scheduler.add('p1', { waiting: 0, failed: 0, completed: 1 })
    scheduler.add('p1', { waiting: 0, failed: 0, completed: 2 })
    scheduler.add('p2', { waiting: 1, failed: 0, completed: 0 })
    scheduler.add('p3', { waiting: 0, failed: 0, completed: 0 })
    scheduler.add('p4', { waiting: 1, failed: 0, completed: 0 })
    scheduler.cancel('p4')
    await vi.advanceTimersByTimeAsync(1999)
    expect(sent).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(sent.sort()).toEqual(['p1 completed 3', 'p2 waiting 1'])
  })

  it('keeps pushes to one phone at least the gap apart, folding what arrives meanwhile into the next one', async () => {
    vi.useFakeTimers()
    const sent: string[] = []
    const scheduler = new PushScheduler(async (_phone, p) => void sent.push(p.kind + ' ' + p.count), 2000, 5500)
    scheduler.add('p1', { waiting: 0, failed: 0, completed: 1 })
    await vi.advanceTimersByTimeAsync(2000)
    scheduler.add('p1', { waiting: 1, failed: 0, completed: 0 })
    await vi.advanceTimersByTimeAsync(2000)
    scheduler.add('p1', { waiting: 1, failed: 0, completed: 0 })
    // 上一条在 2000 发出，下一条最早 7500
    await vi.advanceTimersByTimeAsync(3499)
    expect(sent).toEqual(['completed 1'])
    await vi.advanceTimersByTimeAsync(1)
    expect(sent).toEqual(['completed 1', 'waiting 2'])
  })
})
