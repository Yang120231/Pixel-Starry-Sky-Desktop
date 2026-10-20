import { describe, expect, it } from 'vitest'
import type { Item, SessionSnapshot } from '@pixelsky/protocol'
import { digestsOf, latestTodo } from './sessionDigestModel'

const text = (id: string, t = ''): Item => ({ kind: 'assistant', id, text: t, status: 'running' }) as Item
const todo = (id: string, done = 0): Item =>
  ({
    kind: 'todo',
    id,
    status: 'completed',
    steps: [
      { text: 'a', status: done > 0 ? 'completed' : 'pending' },
      { text: 'b', status: 'pending' },
    ],
  }) as Item
const snap = (items: Item[], pending: SessionSnapshot['pending'] = []): SessionSnapshot =>
  ({ items, pending }) as unknown as SessionSnapshot

describe('会话摘要：只在待处理请求、最新待办变了时换新对象（docs/perf-audit-2026-10-18.md B3）', () => {
  it('别的会话在输出（只改了回复文字）：整份摘要沿用上次的', () => {
    const pending: SessionSnapshot['pending'] = []
    const a = snap([todo('t1'), text('r1', 'he')], pending)
    const first = digestsOf({ a })
    expect(first.a.todo).toMatchObject({ id: 't1' })
    const typed = snap([a.items[0], text('r1', 'hello')], pending)
    expect(digestsOf({ a: typed })).toBe(first)
  })
  it('待办更新、来了新的待办、等你批准：换新对象', () => {
    const pending: SessionSnapshot['pending'] = []
    const items = [todo('t1'), text('r1')]
    const first = digestsOf({ s: snap(items, pending) })
    const updated = digestsOf({ s: snap([todo('t1', 1), items[1]], pending) })
    expect(updated).not.toBe(first)
    expect(updated.s.todo).toMatchObject({ id: 't1', steps: [{ status: 'completed' }, { status: 'pending' }] })
    const newer = digestsOf({ s: snap([todo('t1', 1), items[1], todo('t2')], pending) })
    expect(newer.s.todo).toMatchObject({ id: 't2' })
    const asking = [{ requestId: 'q1' }] as unknown as SessionSnapshot['pending']
    expect(digestsOf({ s: snap(newer.s.todo ? [todo('t1', 1), items[1], todo('t2')] : [], asking) }).s.pending).toBe(
      asking,
    )
  })
  it('找最新待办：增量只看新加的；变短了从头找', () => {
    const items = [todo('t1'), text('r1')]
    const scan = latestTodo(items, undefined)
    expect(scan.index).toBe(0)
    const more = [...items, text('r2'), todo('t2')]
    expect(latestTodo(more, scan).index).toBe(3)
    expect(latestTodo([todo('t9')], latestTodo(more, scan)).index).toBe(0)
    expect(latestTodo([text('x')], undefined).index).toBe(-1)
  })
})
