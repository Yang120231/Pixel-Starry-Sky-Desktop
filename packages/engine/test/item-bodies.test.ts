// 大字段留在磁盘（docs/session-memory.md 第 2 期）：载入的条目截掉图片数据，按 id 从磁盘读回；写盘永远是完整内容
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cutItem, type EngineEvent, type HostEvent, type ImageAttachment, type Item } from '@pixelsky/protocol'
import { EngineHost } from '../src/host'
import { eachLine, Store } from '../src/store'
import { makeTmp, removeTmp } from './helpers/tmp'

// 模拟 Windows 上 items.jsonl 被别的句柄占着、改名失败；平时照常改名
const fail = vi.hoisted(() => ({ rename: false }))
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    renameSync: (from: import('node:fs').PathLike, to: import('node:fs').PathLike) => {
      if (fail.rename && String(to).endsWith('items.jsonl')) throw Object.assign(new Error('EIO'), { code: 'EIO' })
      return fs.renameSync(from, to)
    },
  }
})

let dir: string
beforeEach(() => {
  dir = makeTmp('item-bodies')
})
afterEach(() => removeTmp(dir))

const image = (id: string, dataBase64: string): ImageAttachment => ({
  id,
  name: `${id}.png`,
  mediaType: 'image/png',
  bytes: dataBase64.length,
  width: 1,
  height: 1,
  dataBase64,
})
const user = (id: string, data: string, text = id): Item => ({
  kind: 'user',
  id,
  text,
  createdAt: 1,
  attachments: [image(`${id}-img`, data)],
})
const tool = (id: string, data: string, status: 'running' | 'completed' = 'completed'): Item => ({
  kind: 'tool',
  id,
  tool: 'read',
  name: 'Read',
  title: `${id}.png`,
  output: '',
  status,
  images: [image(`${id}-img`, data)],
})
const plain = (id: string): Item => ({ kind: 'assistant', id, text: id, status: 'completed' })

const file = (session: string, name = 'items.jsonl') => join(dir, 'sessions', session, name)
/** 文件里的原始行（老版本读到的就是这些） */
const rawLines = (session: string, name?: string) =>
  readFileSync(file(session, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>)

describe('截掉的图片数据按 id 从磁盘读回', () => {
  it('loadItems 返回截过的条目，body() 补回完整内容（同一 id 多行取最后一行）', () => {
    const store = new Store(dir)
    store.appendItem('s1', user('u1', 'AAAA'))
    store.appendItem('s1', tool('t1', '', 'running'))
    store.appendItem('s1', plain('a1'))
    store.appendItem('s1', tool('t1', 'BBBB'))

    const loaded = new Store(dir)
    const items = loaded.loadItems('s1')
    expect(items.map(i => i.id)).toEqual(['u1', 't1', 'a1'])
    expect(items[0]).toMatchObject({ cut: true, attachments: [{ id: 'u1-img', dataBase64: '' }] })
    expect(items[1]).toMatchObject({ cut: true, status: 'completed', images: [{ dataBase64: '' }] })
    expect(items[2]).toEqual(plain('a1'))
    expect(loaded.body('s1', items[0])).toEqual(user('u1', 'AAAA'))
    expect(loaded.body('s1', items[1])).toEqual(tool('t1', 'BBBB'))
    expect(loaded.body('s1', items[2])).toBe(items[2])
  })

  it('还在跑的条目读出时标成已中断，再截', () => {
    const store = new Store(dir)
    store.appendItem('s1', tool('t1', 'CCCC', 'running'))
    const [item] = store.loadItems('s1')
    expect(item).toMatchObject({ cut: true, status: 'interrupted' })
    expect(store.body('s1', item)).toEqual({ ...tool('t1', 'CCCC'), status: 'interrupted' })
  })

  it('追加截过的条目：文件里是完整内容、没有 cut；改过的小字段写进去', () => {
    const store = new Store(dir)
    store.appendItem('s1', user('u1', 'AAAA'))
    const [item] = store.loadItems('s1')
    store.appendItem('s1', { ...item, dismissed: true } as Item)
    const last = rawLines('s1').at(-1)!
    expect(last).not.toHaveProperty('cut')
    expect(last).toEqual({ ...user('u1', 'AAAA'), dismissed: true })
    // 位置更新到新行：再取一次仍对
    expect(store.body('s1', { ...item, dismissed: true } as Item)).toEqual({ ...user('u1', 'AAAA'), dismissed: true })
  })

  it('文件结尾是半行（写到一半断电）：补换行后新追加的条目 body() 仍对', () => {
    new Store(dir).appendItem('s1', plain('a1'))
    appendFileSync(file('s1'), '{"kind":"user","id":"tor')
    const store = new Store(dir)
    store.loadItems('s1')
    store.appendItem('s1', user('u2', '中文也行DDDD', '带中文的话'))
    const [, item] = new Store(dir).loadItems('s1')
    expect(item).toMatchObject({ id: 'u2', cut: true })
    // 用追加时记下的位置读回
    expect(store.body('s1', item)).toEqual(user('u2', '中文也行DDDD', '带中文的话'))
  })

  it('replaceItems：从另一个会话补全（from）；keepOld 后去掉的条目从回退前的文件读回；dropUndo 删文件', () => {
    const store = new Store(dir)
    store.appendItem('src', user('u1', 'AAAA'))
    store.appendItem('src', tool('t1', 'BBBB'))
    store.appendItem('src', user('u2', 'CCCC'))
    const items = store.loadItems('src')

    // 分叉：写到新会话，内容从来源补
    store.replaceItems('fork', items.slice(0, 2), { from: 'src' })
    expect(rawLines('fork')).toEqual([user('u1', 'AAAA'), tool('t1', 'BBBB')])

    // 回退：去掉最后一条，保留回退前的文件
    store.replaceItems('src', items.slice(0, 2), { keepOld: true })
    expect(rawLines('src')).toEqual([user('u1', 'AAAA'), tool('t1', 'BBBB')])
    expect(rawLines('src', 'items.undo.jsonl')).toHaveLength(3)
    expect(store.body('src', items[0])).toEqual(user('u1', 'AAAA'))
    expect(store.body('src', items[2])).toEqual(user('u2', 'CCCC'))
    // 撤销回退：去掉的条目从 undo 文件补全写回
    store.replaceItems('src', items)
    expect(rawLines('src')).toEqual([user('u1', 'AAAA'), tool('t1', 'BBBB'), user('u2', 'CCCC')])
    expect(rawLines('src').some(line => 'cut' in line)).toBe(false)

    store.dropUndo('src')
    expect(existsSync(file('src', 'items.undo.jsonl'))).toBe(false)
    // 新文件的位置已经换上
    expect(store.body('src', items[2])).toEqual(user('u2', 'CCCC'))
  })

  it('第二次回退改名失败：上一次回退留下的文件和位置都不动，撤销仍能补回', () => {
    const store = new Store(dir)
    store.appendItem('s', user('u1', 'AAAA'))
    store.appendItem('s', user('u2', 'BBBB'))
    store.appendItem('s', user('u3', 'CCCC'))
    const items = store.loadItems('s')
    store.replaceItems('s', items.slice(0, 2), { keepOld: true })
    fail.rename = true
    try {
      expect(() => store.replaceItems('s', items.slice(0, 1), { keepOld: true })).toThrow('EIO')
    } finally {
      fail.rename = false
    }
    expect(rawLines('s')).toHaveLength(2)
    expect(rawLines('s', 'items.undo.jsonl')).toHaveLength(3)
    expect(existsSync(file('s', 'items.undo.jsonl.next'))).toBe(false)
    expect(store.body('s', items[2])).toEqual(user('u3', 'CCCC'))
    // 回退到一半崩溃留下的临时名：重新载入时删掉
    writeFileSync(file('s', 'items.undo.jsonl.next'), 'x')
    store.loadItems('s')
    expect(existsSync(file('s', 'items.undo.jsonl.next'))).toBe(false)
  })

  it('文件被外面改掉（位置失效）：body() 返回 null，写截过的条目抛错、文件不变', () => {
    const store = new Store(dir)
    store.appendItem('s1', user('u1', 'AAAA'))
    store.appendItem('s1', user('u2', 'BBBB'))
    const items = store.loadItems('s1')
    writeFileSync(file('s1'), JSON.stringify(plain('x')) + '\n' + JSON.stringify(plain('y')) + '\n')
    const before = readFileSync(file('s1'), 'utf8')

    expect(store.body('s1', items[1])).toBeNull()
    expect(() => store.appendItem('s1', items[0])).toThrow('条目内容读不回来')
    expect(() => store.replaceItems('s1', items)).toThrow('条目内容读不回来')
    expect(readFileSync(file('s1'), 'utf8')).toBe(before)
    expect(existsSync(`${file('s1')}.tmp`)).toBe(false)
  })

  it('readItem：没载入的会话按 id 取最后一次的内容，running 变 interrupted；没有的返回 null', () => {
    const store = new Store(dir)
    store.appendItem('s1', tool('t1', '', 'running'))
    store.appendItem('s1', user('u1', 'AAAA'))
    store.appendItem('s1', tool('t1', 'BBBB', 'running'))

    const fresh = new Store(dir)
    expect(fresh.readItem('s1', 't1')).toEqual({ ...tool('t1', 'BBBB'), status: 'interrupted' })
    expect(fresh.readItem('s1', 'u1')).toEqual(user('u1', 'AAAA'))
    expect(fresh.readItem('s1', 'nope')).toBeNull()
    expect(fresh.readItem('empty', 'u1')).toBeNull()
    // 载入后走索引，结果一样
    fresh.loadItems('s1')
    expect(fresh.readItem('s1', 't1')).toEqual({ ...tool('t1', 'BBBB'), status: 'interrupted' })
  })

  it('内存：50 条各带 1 MB 图片的条目载入后，图片不留在堆里', () => {
    const store = new Store(dir)
    {
      const data = 'A'.repeat(1 << 20)
      const lines = Array.from({ length: 50 }, (_, i) =>
        JSON.stringify(i % 2 ? user(`u${i}`, data) : tool(`t${i}`, data)),
      )
      store.appendItem('s1', plain('first'))
      appendFileSync(file('s1'), lines.join('\n') + '\n')
    }
    setFlagsFromString('--expose_gc')
    const gc = runInNewContext('gc') as () => void
    gc()
    const before = process.memoryUsage().heapUsed
    const items = store.loadItems('s1')
    gc()
    const grown = process.memoryUsage().heapUsed - before
    expect(items).toHaveLength(51)
    expect(grown).toBeLessThan(15 * (1 << 20))
    // 对照：补回全部图片后约 50 MB，说明上面量得出来
    const full = items.map(item => store.body('s1', item))
    gc()
    expect(process.memoryUsage().heapUsed - before).toBeGreaterThan(40 * (1 << 20))
    expect(full[2]?.kind === 'user' && full[2].attachments?.[0].dataBase64.length).toBe(1 << 20)
    // 50 MB 的文件跨了好几块（每块 16 MB）：每条的位置都对
    expect(full.every(item => item && !item.cut)).toBe(true)
  })

  it('按行读给出的字节起点和长度：行和中文跨块、结尾没换行、CRLF 都对得上', () => {
    const path = join(dir, 'lines.txt')
    const text = '第一行\n\nabc对话条目xyz\r\n' + '很长'.repeat(20) + '\n最后一行没换行'
    writeFileSync(path, text)
    const bytes = readFileSync(path)
    for (const chunk of [1, 2, 3, 5, 7, 64]) {
      const got: string[] = []
      eachLine(
        path,
        (line, offset, length) => {
          expect(bytes.subarray(offset, offset + length).toString('utf8')).toBe(line)
          got.push(line)
        },
        chunk,
      )
      expect(got.join('\n')).toBe(text)
    }
  })
})

describe('宿主：快照里截掉，磁盘和广播的是完整的', () => {
  type Apply = { m: { events: { apply(id: string, event: EngineEvent): void } } }
  type Runtimes = { runtimes: Map<string, unknown> }
  function opened() {
    const events: HostEvent[] = []
    const host = new EngineHost({ dataDir: dir, emit: e => events.push(e), adapters: {} })
    const project = join(dir, 'project')
    mkdirSync(project, { recursive: true })
    const record = host.createSession({ projectId: host.addProject(project).id })
    host.open(record.id)
    const apply = (event: EngineEvent) => (host as unknown as Apply).m.events.apply(record.id, event)
    const lines = () => rawLines(record.id).map(line => line.id)
    return { host, record, events, apply, lines }
  }
  const sent = (events: HostEvent[], id: string) =>
    events.flatMap(e =>
      e.kind === 'session' &&
      (e.event.type === 'item_completed' || e.event.type === 'item_started') &&
      e.event.item.id === id
        ? [e.event.item]
        : [],
    )

  it('条目完成：磁盘写完整的，快照留截过的，广播完整的；还在跑的不截，一轮结束收尾时落盘再截，没变的不重写', async () => {
    const t = opened()
    try {
      t.apply({ type: 'item_completed', item: user('u1', 'AAAA') })
      t.apply({ type: 'turn_started', turnId: 'turn' })
      t.apply({ type: 'item_started', item: tool('t1', 'BBBB', 'running') })
      expect(t.host.open(t.record.id).items).toEqual([cutItem(user('u1', 'AAAA')), tool('t1', 'BBBB', 'running')])
      expect(sent(t.events, 'u1')).toEqual([user('u1', 'AAAA')])
      t.apply({ type: 'turn_completed', turnId: 'turn', outcome: 'completed', error: null })
      expect(t.host.open(t.record.id).items[1]).toEqual(cutItem(tool('t1', 'BBBB')))
      // u1 一行；t1 开始一行、收尾一行
      expect(t.lines()).toEqual(['u1', 't1', 't1'])
      expect(rawLines(t.record.id)).toEqual([user('u1', 'AAAA'), tool('t1', 'BBBB', 'running'), tool('t1', 'BBBB')])
      expect(t.host.item(t.record.id, 't1')).toEqual(tool('t1', 'BBBB'))
      // 整份换掉（加载更早的）：快照里截
      t.apply({ type: 'items_reset', items: [user('u0', 'CCCC'), ...t.host.open(t.record.id).items] })
      expect(t.host.open(t.record.id).items[0]).toEqual(cutItem(user('u0', 'CCCC')))
    } finally {
      await t.host.shutdown()
    }
  })

  it('host.item：已载入的截过的按 id 补回；没载入的从磁盘读、不建运行时；没有的为 null，会话不存在报错', async () => {
    const t = opened()
    t.apply({ type: 'item_completed', item: user('u1', 'AAAA') })
    expect(t.host.item(t.record.id, 'u1')).toEqual(user('u1', 'AAAA'))
    expect(t.host.item(t.record.id, 'nope')).toBeNull()
    await t.host.shutdown()
    const host = new EngineHost({ dataDir: dir, emit: () => {}, adapters: {} })
    try {
      expect(host.item(t.record.id, 'u1')).toEqual(user('u1', 'AAAA'))
      expect(host.item(t.record.id, 'nope')).toBeNull()
      expect((host as unknown as Runtimes).runtimes.size).toBe(0)
      expect(() => host.item('no-such-session', 'u1')).toThrow('会话不存在')
    } finally {
      await host.shutdown()
    }
  })
})
