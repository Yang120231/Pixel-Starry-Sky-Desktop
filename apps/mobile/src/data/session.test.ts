import { describe, expect, it } from 'vitest'
import { emptySnapshot, type EngineEvent, type Item, type SessionRecord } from '@pixelsky/protocol'
import { applyEvent, applyTail, emptyView, prependOlder, replaceItem, type Tail } from './session'
import { groupTasks, taskTitle } from './tasks'

const record = { id: 's1', title: 't' } as SessionRecord
const assistant = (id: string, text: string): Item => ({ kind: 'assistant', id, text, status: 'completed' })
const tail = (items: Item[], seq: number, before: string | null = null): Tail => ({
  snapshot: emptySnapshot(record, items),
  seq,
  before,
  truncated: [],
})
const started = (id: string): EngineEvent => ({ type: 'item_started', item: assistant(id, '') }) as EngineEvent
const delta = (id: string, text: string): EngineEvent =>
  ({ type: 'item_delta', itemId: id, field: 'text', delta: text }) as EngineEvent

describe('session view', () => {
  it('buffers events until the snapshot arrives, then replays only newer ones', () => {
    let v = emptyView()
    v = applyEvent(v, 5, started('a'))
    v = applyEvent(v, 6, delta('a', '你好'))
    v = applyTail(v, tail([], 5))
    expect(v.seq).toBe(6)
    // seq 5 已经包含在快照里，不会重复加；6 补上了，但快照里没有 a，所以 delta 被丢（和桌面一致）
    v = applyEvent(v, 7, started('b'))
    v = applyEvent(v, 8, delta('b', '世界'))
    expect(v.snapshot!.items.map(i => (i as { text: string }).text)).toEqual(['世界'])
    expect(v.seq).toBe(8)
  })

  it('ignores duplicates and marks a gap as stale', () => {
    let v = applyTail(emptyView(), tail([assistant('a', 'x')], 3))
    v = applyEvent(v, 3, delta('a', 'dup'))
    expect((v.snapshot!.items[0] as { text: string }).text).toBe('x')
    v = applyEvent(v, 5, delta('a', 'skip'))
    expect(v.stale).toBe(true)
    expect(applyEvent(v, 6, delta('a', 'more'))).toBe(v)
  })

  it('prepends older items without duplicates and swaps in full items', () => {
    let v = applyTail(emptyView(), { ...tail([assistant('c', 'c')], 1, 'c'), truncated: ['c'] })
    v = prependOlder(v, tail([assistant('a', 'a'), assistant('b', 'b'), assistant('c', 'old')], 1))
    expect(v.snapshot!.items.map(i => i.id)).toEqual(['a', 'b', 'c'])
    expect(v.before).toBeNull()
    v = replaceItem(v, assistant('c', 'full'), false)
    expect((v.snapshot!.items[2] as { text: string }).text).toBe('full')
    expect(v.truncated).toEqual([])
  })
})

describe('task groups', () => {
  const s = (id: string, state: string, updatedAt: number, archivedAt: number | null = null) =>
    ({ record: { id, title: id === 'x' ? '  ' : id, updatedAt, archivedAt }, state }) as never
  it('splits waiting, running and recent, newest first, without archived', () => {
    const g = groupTasks([
      s('a', 'idle', 1),
      s('b', 'waiting', 2),
      s('c', 'running', 3),
      s('d', 'starting', 4),
      s('e', 'idle', 5),
      s('f', 'idle', 9, 1),
    ])
    expect(g.waiting.map(x => x.record.id)).toEqual(['b'])
    expect(g.running.map(x => x.record.id)).toEqual(['d', 'c'])
    expect(g.recent.map(x => x.record.id)).toEqual(['e', 'a'])
    expect(taskTitle(s('x', 'idle', 1))).toBe('未命名任务')
  })
})
