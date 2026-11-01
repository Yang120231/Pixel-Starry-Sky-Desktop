// 内存里截掉图片数据、长输出只留头尾，按磁盘上的完整条目补回（docs/session-memory.md 第 2、3 期）
import { describe, expect, it } from 'vitest'
import type { ImageAttachment, Item } from './types'
import { CUT_EDGE, CUT_OVER, cutItem, withBodies } from './itemCut'
import { emptySnapshot, reduce } from './reduce'

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

const tool = (status: 'running' | 'completed', images?: ImageAttachment[], output = ''): Item => ({
  kind: 'tool',
  id: 't1',
  tool: 'read',
  name: 'Read',
  title: 'a.png',
  output,
  status,
  images,
})

const command = (output: string, status: 'running' | 'completed' = 'completed'): Item => ({
  kind: 'command',
  id: 'c1',
  command: 'ls',
  description: null,
  output,
  exitCode: 0,
  status,
})

/** 每个位置不一样的长文本，头尾截错了看得出来 */
const long = (n: number): string => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + (i % 26))).join('')
const outputOf = (item: Item): string => (item.kind === 'command' || item.kind === 'tool' ? item.output : '')

describe('cutItem', () => {
  it('还在跑的、没有大字段的、别的种类原样返回', () => {
    for (const item of [
      tool('running', [image('i1')]),
      tool('completed'),
      tool('completed', [image('i1', '')]),
      user(),
      user([]),
      { kind: 'assistant', id: 'a1', text: '好', status: 'completed' } as Item,
      command(long(CUT_OVER)),
      command(long(CUT_OVER * 4), 'running'),
      tool('running', undefined, long(CUT_OVER * 4)),
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
    expect(t).not.toHaveProperty('cutChars')
  })

  it('超过 CUT_OVER 的输出只留头尾和一行省略说明，记下原长度；其它字段不变', () => {
    const text = long(CUT_OVER + 1)
    const omitted = text.length - 2 * CUT_EDGE
    const marker = `\n... [${omitted} chars omitted] ...\n`
    const cut = cutItem(command(text))
    expect(cut).toEqual({
      ...command(text),
      output: text.slice(0, CUT_EDGE) + marker + text.slice(-CUT_EDGE),
      cutChars: text.length,
      cut: true,
    })
    expect(cutItem(cut)).toBe(cut)

    // 工具：输出和图片一起截
    const t = cutItem(tool('completed', [image('i3')], text))
    expect(t).toMatchObject({ cut: true, cutChars: text.length, images: [{ dataBase64: '' }] })
    expect(outputOf(t)).toBe(outputOf(cut))
  })

  it('边界落在代理对中间时少留一个，不劈开 emoji', () => {
    // 头的最后一个是高代理项、尾的第一个是低代理项
    const text = 'a'.repeat(CUT_EDGE - 1) + '😀' + 'b'.repeat(CUT_OVER) + '😀' + 'c'.repeat(CUT_EDGE - 1)
    const output = outputOf(cutItem(command(text)))
    const omitted = text.length - 2 * (CUT_EDGE - 1)
    expect(output).toBe(`${'a'.repeat(CUT_EDGE - 1)}\n... [${omitted} chars omitted] ...\n${'c'.repeat(CUT_EDGE - 1)}`)
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

  it('补回截过的输出，去掉 cutChars；只截了输出时内存里后补的图片留着', () => {
    const text = long(CUT_OVER * 3)
    const full = command(text)
    const cut = { ...cutItem(full), exitCode: 1 } as Item
    const restored = withBodies(cut, full)
    expect(restored).toEqual({ ...full, exitCode: 1 })
    expect(restored).not.toHaveProperty('cutChars')

    // Codex 旧版看图条目：载入后才补上图片，磁盘上那行还没有
    const onDisk = tool('completed', undefined, text)
    const shown = { ...cutItem(onDisk), images: [image('i4')] } as Item
    expect(withBodies(shown, onDisk)).toEqual({ ...onDisk, images: [image('i4')] })
  })
})

describe('reduce', () => {
  it('输出增量不接在截过的条目上', () => {
    const record = { id: 's1' } as Parameters<typeof emptySnapshot>[0]
    const cut = cutItem(command(long(CUT_OVER * 2)))
    const s = emptySnapshot(record, [cut])
    expect(reduce(s, { type: 'item_delta', itemId: 'c1', field: 'output', delta: 'x' })).toBe(s)
    const running = emptySnapshot(record, [command('a', 'running')])
    expect(outputOf(reduce(running, { type: 'item_delta', itemId: 'c1', field: 'output', delta: 'x' }).items[0])).toBe(
      'ax',
    )
  })
})
