// 桌面界面不常驻图片原图（docs/perf-audit-2026-10-18.md B1）
import { describe, expect, it } from 'vitest'
import type { HostEvent, ImageAttachment, Item, OpenedSession } from '@pixelsky/protocol'
import { eventForDesktop, imageOf, itemWithoutImageData, openedForDesktop } from './desktop-images'

const image = (id: string, data = 'QUJD'): ImageAttachment => ({
  id,
  name: id + '.png',
  mediaType: 'image/png',
  bytes: 3,
  width: 1,
  height: 1,
  dataBase64: data,
})
const user = (id: string, attachments?: ImageAttachment[]): Item =>
  ({ kind: 'user', id, text: '看图', ...(attachments ? { attachments } : {}) }) as Item
const tool = (id: string, images?: ImageAttachment[]): Item =>
  ({ kind: 'tool', id, name: 'Read', title: 'a.png', output: '', status: 'completed', images }) as Item

describe('去掉图片数据', () => {
  it('用户发的图、工具结果里的图换成空串，名字、大小、宽高留着；不改原对象', () => {
    const original = user('u1', [image('i1')])
    const out = itemWithoutImageData(original) as Extract<Item, { kind: 'user' }>
    expect(out.attachments![0]).toEqual({ ...image('i1'), dataBase64: '' })
    expect((original as Extract<Item, { kind: 'user' }>).attachments![0].dataBase64).toBe('QUJD')
    const t = itemWithoutImageData(tool('t1', [image('i2')])) as Extract<Item, { kind: 'tool' }>
    expect(t.images![0].dataBase64).toBe('')
  })
  it('没有图片数据的条目原样返回（不多复制）', () => {
    const plain = user('u2')
    expect(itemWithoutImageData(plain)).toBe(plain)
    const opened = { snapshot: { items: [plain] }, seq: 1 } as unknown as OpenedSession
    expect(openedForDesktop(opened)).toBe(opened)
  })
  it('打开会话的快照、条目开始 / 完成、整份换掉的事件都去掉；别的事件原样', () => {
    const opened = { snapshot: { items: [user('u1', [image('i1')])] }, seq: 1 } as unknown as OpenedSession
    const out = openedForDesktop(opened)
    expect((out.snapshot.items[0] as Extract<Item, { kind: 'user' }>).attachments![0].dataBase64).toBe('')
    const started = {
      kind: 'session',
      sessionId: 's',
      seq: 2,
      event: { type: 'item_started', item: tool('t', [image('x')]) },
    }
    const slim = eventForDesktop(started as HostEvent) as typeof started
    expect((slim.event.item as Extract<Item, { kind: 'tool' }>).images![0].dataBase64).toBe('')
    const reset = {
      kind: 'session',
      sessionId: 's',
      seq: 3,
      event: { type: 'items_reset', items: [user('u', [image('y')])] },
    }
    const r = eventForDesktop(reset as HostEvent) as typeof reset
    expect((r.event.items[0] as Extract<Item, { kind: 'user' }>).attachments![0].dataBase64).toBe('')
    const other = { kind: 'session', sessionId: 's', seq: 4, event: { type: 'status', state: 'idle' } } as HostEvent
    expect(eventForDesktop(other)).toBe(other)
  })
  it('按需取原图：按条目和图片 id 找', () => {
    const items = [user('u1', [image('a'), image('b', 'REVG')]), tool('t1', [image('c')])]
    expect(imageOf(items, 'u1', 'b')?.dataBase64).toBe('REVG')
    expect(imageOf(items, 't1', 'c')?.id).toBe('c')
    expect(imageOf(items, 'u1', 'zz')).toBeNull()
    expect(imageOf(items, 'nope', 'a')).toBeNull()
  })
})
