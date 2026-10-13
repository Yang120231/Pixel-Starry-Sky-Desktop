// 文字增量合并：同一块 stdout 里连续的增量合成一条再应用 / 广播，且不越过其他事件
import { describe, expect, it } from 'vitest'
import type { EngineEvent, HostEvent } from '@pixelsky/protocol'
import type { HostContext, Runtime } from '../src/host/context'
import { HostEvents } from '../src/host/events'

function setup(ids: string[] = ['a']) {
  const emitted: HostEvent[] = []
  const runtimes = new Map<string, Runtime>()
  for (const id of ids) {
    runtimes.set(id, {
      seq: 0,
      snapshot: {
        turnId: 't1',
        state: 'running',
        items: [
          { kind: 'assistant', id: 'm1', text: '', createdAt: 0 },
          { kind: 'assistant', id: 'm2', text: '', createdAt: 0 },
          { kind: 'command', id: 'c1', output: '' },
        ],
      },
    } as unknown as Runtime)
  }
  const ctx = {
    runtimes,
    records: new Map(),
    store: { appendItem() {}, saveRecord() {} },
    opts: { emit: (e: HostEvent) => emitted.push(e) },
    m: { sessions: { sessions: () => [] } },
  } as unknown as HostContext
  const events = new HostEvents(ctx)
  const text = (id: string, itemId: string) => {
    const item = runtimes.get(id)!.snapshot.items.find(x => x.id === itemId) as { text?: string; output?: string }
    return item.text ?? item.output
  }
  const deltas = (id?: string) =>
    emitted.filter(
      (e): e is Extract<HostEvent, { kind: 'session' }> =>
        e.kind === 'session' && e.event.type === 'item_delta' && (!id || e.sessionId === id),
    )
  return { events, emitted, runtimes, text, deltas }
}
const delta = (itemId: string, d: string, field: 'text' | 'output' = 'text'): EngineEvent => ({
  type: 'item_delta',
  itemId,
  field,
  delta: d,
})

describe('文字增量合并', () => {
  it('同一条目的连续增量合成一条', async () => {
    const t = setup()
    for (let i = 0; i < 300; i++) t.events.onEngineEvent('a', delta('m1', 'x'))
    expect(t.deltas()).toHaveLength(0)
    await Promise.resolve()
    const out = t.deltas()
    expect(out).toHaveLength(1)
    expect((out[0].event as { delta: string }).delta).toBe('x'.repeat(300))
    expect(t.text('a', 'm1')).toBe('x'.repeat(300))
  })

  it('中间夹着别的事件时保持顺序', () => {
    const t = setup()
    t.events.onEngineEvent('a', delta('m1', 'ab'))
    t.events.apply('a', { type: 'status', state: 'waiting' })
    const kinds = t.emitted.map(e => (e.kind === 'session' ? e.event.type : e.kind))
    expect(kinds.slice(0, 2)).toEqual(['item_delta', 'status'])
    expect(t.text('a', 'm1')).toBe('ab')
  })

  it('不同条目 / 字段不合并', async () => {
    const t = setup()
    t.events.onEngineEvent('a', delta('m1', '1'))
    t.events.onEngineEvent('a', delta('m2', '2'))
    t.events.onEngineEvent('a', delta('c1', '3', 'output'))
    t.events.onEngineEvent('a', delta('c1', '4', 'text'))
    await Promise.resolve()
    expect(t.deltas().map(e => (e.event as { delta: string }).delta)).toEqual(['1', '2', '3', '4'])
    expect(t.text('a', 'm1')).toBe('1')
    expect(t.text('a', 'm2')).toBe('2')
    expect(t.text('a', 'c1')).toBe('3')
  })

  it('两个会话互不影响', async () => {
    const t = setup(['a', 'b'])
    t.events.onEngineEvent('a', delta('m1', 'A'))
    t.events.onEngineEvent('b', delta('m1', 'B'))
    t.events.onEngineEvent('a', delta('m1', 'A'))
    await Promise.resolve()
    expect(t.deltas('a')).toHaveLength(1)
    expect(t.text('a', 'm1')).toBe('AA')
    expect(t.text('b', 'm1')).toBe('B')
  })

  it('下一块输出产生新的事件', async () => {
    const t = setup()
    t.events.onEngineEvent('a', delta('m1', 'a'))
    await Promise.resolve()
    t.events.onEngineEvent('a', delta('m1', 'b'))
    await Promise.resolve()
    expect(t.deltas().map(e => (e.event as { delta: string }).delta)).toEqual(['a', 'b'])
    expect(t.deltas().map(e => e.seq)).toEqual([1, 2])
  })

  it('会话已移除时丢弃', async () => {
    const t = setup()
    t.events.onEngineEvent('a', delta('m1', 'a'))
    t.runtimes.delete('a')
    await Promise.resolve()
    expect(t.emitted).toHaveLength(0)
  })
})
