// 内存里截掉图片数据、按磁盘上的完整条目补回（docs/session-memory.md 第 2 期）
import { describe, expect, it } from 'vitest'
import type { ImageAttachment, Item } from './types'
import { cutItem, withBodies } from './itemCut'

const image = (id: string, dataBase64 = 'QUJD'): ImageAttachment => ({
  id,
  name: `${id}.png`,
  mediaType: 'image/png',
  bytes: 3,
  width: 1,
  height: 1,
  dataBase64,
})

const user = (attachments?: ImageAttachment[]): Item => ({
  kind: 'user',
  id: 'u1',
  text: '看图',
  createdAt: 1,
  attachments,
})

const tool = (status: 'running' | 'completed', images?: ImageAttachment[]): Item => ({
  kind: 'tool',
  id: 't1',
  tool: 'read',
  name: 'Read',
  title: 'a.png',
  output: '',
  status,
  images,
})

describe('cutItem', () => {
  it('还在跑的、没有图片数据的、别的种类原样返回', () => {
    for (const item of [
      tool('running', [image('i1')]),
      tool('completed'),
      tool('completed', [image('i1', '')]),
      user(),
      user([]),
      { kind: 'assistant', id: 'a1', text: '好', status: 'completed' } as Item,
    ])
      expect(cutItem(item)).toBe(item)
  })

  it('空掉图片数据、保留其它字段，标 cut；不改入参；截过的再截原样返回', () => {
    const item = user([image('i1'), image('i2', '')])
    const before = JSON.parse(JSON.stringify(item)) as Item
    const cut = cutItem(item)
    expect(cut).toEqual({ ...item, attachments: [image('i1', ''), image('i2', '')], cut: true })
    expect(item).toEqual(before)
    expect(cutItem(cut)).toBe(cut)

    const t = cutItem(tool('completed', [image('i3')]))
    expect(t).toMatchObject({ cut: true, images: [{ id: 'i3', name: 'i3.png', bytes: 3, dataBase64: '' }] })
  })
})

describe('withBodies', () => {
  it('补回图片数据，去掉 cut，内存里改过的小字段保留', () => {
    const full = user([image('i1')])
    const cut = { ...cutItem(full), dismissed: true, engine: 'codex' } as Item
    expect(withBodies(cut, full)).toEqual({ ...full, dismissed: true, engine: 'codex' })
    expect(withBodies(cut, full)).not.toHaveProperty('cut')

    const fullTool = tool('completed', [image('i3')])
    const cutTool = { ...cutItem(fullTool), status: 'failed' } as Item
    expect(withBodies(cutTool, tool('running', [image('i3')]))).toEqual({ ...fullTool, status: 'failed' })
  })
})
