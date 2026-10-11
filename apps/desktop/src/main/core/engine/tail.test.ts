import { describe, expect, it } from 'vitest'
import type { Item, OpenedSession, SessionSnapshot } from '@pixelsky/protocol'
import { itemDetail, sessionTail, slimForPhone, tailOptions } from './tail'

const assistant = (i: number, text = `回复 ${i}`): Item => ({
  kind: 'assistant',
  id: `a${i}`,
  text,
  status: 'completed',
})

function opened(items: Item[], extra: Partial<SessionSnapshot> = {}): OpenedSession {
  return { snapshot: { items, queue: [], pending: [], ...extra } as unknown as SessionSnapshot, seq: 7 }
}

const image = (bytes: number) => ({
  id: 'img',
  name: 'a.png',
  mediaType: 'image/png' as const,
  bytes,
  width: 10,
  height: 10,
  dataBase64: 'A'.repeat(bytes),
})

describe('sessionTail', () => {
  it('returns the last items and a cursor for older ones', () => {
    const items = Array.from({ length: 100 }, (_, i) => assistant(i))
    const tail = sessionTail(opened(items), tailOptions({ limit: 30 }))
    expect(tail.snapshot.items.map(i => i.id)).toEqual(items.slice(70).map(i => i.id))
    expect(tail).toMatchObject({ seq: 7, total: 100, before: 'a70', truncated: [] })
    const older = sessionTail(opened(items), tailOptions({ limit: 30, before: tail.before }))
    expect(older.snapshot.items[0].id).toBe('a40')
    expect(older.before).toBe('a40')
    const first = sessionTail(opened(items), tailOptions({ limit: 50, before: 'a30' }))
    expect(first.snapshot.items).toHaveLength(30)
    expect(first.before).toBeNull()
  })

  it('drops image data, cuts long text and stops at the byte budget', () => {
    const user = { kind: 'user', id: 'u1', text: 'hi', attachments: [image(5000)] } as unknown as Item
    const items = [
      user,
      assistant(1, 'x'.repeat(10_000)),
      ...Array.from({ length: 40 }, (_, i) => assistant(i + 2, 'y'.repeat(4000))),
    ]
    const tail = sessionTail(
      opened(items, { queue: [{ attachments: [image(100)] }] } as never),
      tailOptions({ limit: 200 }),
    )
    // 4000 字的条目每条约 4 KB：128 KB 放不下全部 42 条
    expect(tail.snapshot.items.length).toBeLessThan(42)
    expect(JSON.stringify(tail.snapshot.items).length).toBeLessThanOrEqual(128 * 1024)
    const all = sessionTail(opened(items.slice(0, 2)), tailOptions({}))
    const [u, a] = all.snapshot.items as [Extract<Item, { kind: 'user' }>, Extract<Item, { kind: 'assistant' }>]
    expect(u.attachments?.[0]).toMatchObject({ dataBase64: '', bytes: 5000, width: 10 })
    expect(a.text).toHaveLength(4096)
    expect(all.truncated).toEqual(['u1', 'a1'])
    expect(JSON.stringify(tail.snapshot.queue)).not.toContain('AAAA')
  })

  it('always returns at least one item and clamps the limit', () => {
    const huge = sessionTail(opened([assistant(1, 'z'.repeat(400_000))]), { limit: 60, before: null, maxBytes: 10 })
    expect(huge.snapshot.items).toHaveLength(1)
    expect(tailOptions({ limit: 10_000 }).limit).toBe(200)
    expect(tailOptions({ limit: 0 }).limit).toBe(1)
    expect(tailOptions(null)).toEqual({ limit: 60, before: null, maxBytes: 128 * 1024 })
  })
})

describe('itemDetail', () => {
  it('returns the full item, with images only when they fit in one frame', () => {
    const user = { kind: 'user', id: 'u1', text: 'hi', attachments: [image(1000)] } as unknown as Item
    const big = { kind: 'user', id: 'u2', text: 'hi', attachments: [image(900_000)] } as unknown as Item
    const snapshot = opened([user, big, assistant(1, 'w'.repeat(300_000))]).snapshot
    expect(itemDetail(snapshot, 'u1')).toEqual({ item: user, truncated: false })
    const second = itemDetail(snapshot, 'u2')!
    expect(JSON.stringify(second.item)).not.toContain('AAAA')
    expect(second.truncated).toBe(true)
    const long = itemDetail(snapshot, 'a1')!
    expect((long.item as { text: string }).text).toHaveLength(256 * 1024)
    expect(itemDetail(snapshot, 'missing')).toBeNull()
  })

  it('slims events the same way', () => {
    const event = { kind: 'session', sessionId: 's', seq: 1, event: { item: assistant(1, 'q'.repeat(9000)) } }
    expect(JSON.stringify(slimForPhone(event)).length).toBeLessThan(5000)
  })
})
