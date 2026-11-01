// 首次打开大对话不卡主进程（docs/session-memory.md 第 4 期第 1 件）：分块读的结果和同步读一样，宿主 prepare 读完建运行时
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineEvent, ImageAttachment, Item } from '@pixelsky/protocol'
import { EngineHost } from '../src/host'
import { Store } from '../src/store'
import { makeTmp, removeTmp } from './helpers/tmp'

let dir: string
beforeEach(() => {
  dir = makeTmp('prepare')
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
const command = (id: string, output: string): Item => ({
  kind: 'command',
  id,
  command: 'pnpm build',
  description: null,
  output,
  exitCode: 0,
  status: 'completed',
})
const plain = (id: string): Item => ({ kind: 'assistant', id, text: id, status: 'completed' })
const file = (session: string, name = 'items.jsonl') => join(dir, 'sessions', session, name)

describe('Store.loadItemsAsync', () => {
  it('和 loadItems 结果一样：条目、body()、位置；读到的字节数是文件大小；删掉残留的撤销文件', async () => {
    const a = new Store(dir)
    a.appendItem('s1', user('u1', 'AAAA', '带中文的话'))
    a.appendItem('s1', tool('t1', '', 'running'))
    a.appendItem('s1', plain('a1'))
    a.appendItem('s1', tool('t1', 'BBBB'))
    a.appendItem('s1', tool('t2', 'CCCC', 'running'))
    a.appendItem('s1', {
      kind: 'notice',
      id: 'n1',
      level: 'warn',
      text: 'Codex is ignoring 2 unrecognized configuration settings',
    })
    a.appendItem('s1', command('c1', '长输出'.repeat(5000)))
    // 写到一半断电的半行；下一个进程追加时先补换行
    appendFileSync(file('s1'), '{"kind":"assistant","id":"half"')
    new Store(dir).appendItem('s1', plain('a2'))
    // 结尾没换行的完整一行
    appendFileSync(file('s1'), JSON.stringify(plain('tail')))

    const syncStore = new Store(dir)
    const sync = syncStore.loadItems('s1')
    expect(sync.map(i => i.id)).toEqual(['u1', 't1', 'a1', 't2', 'c1', 'a2', 'tail'])
    expect(sync[3]).toMatchObject({ status: 'interrupted', cut: true })
    expect(sync[4].cutChars).toBe(15000)
    const bodies = sync.map(i => syncStore.body('s1', i))

    for (const chunk of [1, 7, 64, 1 << 20]) {
      writeFileSync(file('s1', 'items.undo.jsonl'), '')
      writeFileSync(file('s1', 'items.undo.jsonl.next'), '')
      const store = new Store(dir)
      const { items, bytes } = await store.loadItemsAsync('s1', chunk)
      expect(items).toEqual(sync)
      expect(bytes).toBe(statSync(file('s1')).size)
      expect(items.map(i => store.body('s1', i))).toEqual(bodies)
      expect(existsSync(file('s1', 'items.undo.jsonl'))).toBe(false)
      expect(existsSync(file('s1', 'items.undo.jsonl.next'))).toBe(false)
    }
    // 没有条目文件：空的，之后追加的也记位置
    const store = new Store(dir)
    expect(await store.loadItemsAsync('empty')).toEqual({ items: [], bytes: 0 })
    store.appendItem('empty', user('u9', 'ZZZZ'))
    expect(store.body('empty', { ...user('u9', ''), cut: true })).toEqual(user('u9', 'ZZZZ'))
  })
})

describe('宿主 prepare', () => {
  type Inner = { ctx: { store: Store }; runtimes: Map<string, unknown> }
  type Apply = { m: { events: { apply(id: string, event: EngineEvent): void } } }
  // 一个存好的、没载入的会话：3 条 1 MB 输出，按 1 MB 一块读至少分 3 块
  async function saved() {
    let host = new EngineHost({ dataDir: dir, emit: () => {}, adapters: {} })
    const project = join(dir, 'project')
    mkdirSync(project, { recursive: true })
    const id = host.createSession({ projectId: host.addProject(project).id }).id
    await host.shutdown()
    const store = new Store(dir)
    store.appendItem(id, user('u1', 'AAAA'))
    for (let i = 0; i < 3; i++) store.appendItem(id, command(`c${i}`, 'x'.repeat(1 << 20)))
    host = new EngineHost({ dataDir: dir, emit: () => {}, adapters: {} })
    const inner = host as unknown as Inner
    return { host, id, store: inner.ctx.store, runtimes: inner.runtimes }
  }
  const tick = () => new Promise(r => setImmediate(r))

  it('读完建运行时，openSession 不再同步读；并发两次只读一次；会话不存在报错', async () => {
    const t = await saved()
    const read = vi.spyOn(t.store, 'loadItemsAsync')
    const sync = vi.spyOn(t.store, 'loadItems')
    try {
      await Promise.all([t.host.prepare(t.id), t.host.prepare(t.id)])
      await t.host.prepare(t.id)
      expect(read).toHaveBeenCalledTimes(1)
      const { snapshot } = t.host.openSession(t.id)
      expect(sync).not.toHaveBeenCalled()
      expect(snapshot.items.map(i => i.id)).toEqual(['u1', 'c0', 'c1', 'c2'])
      expect(t.host.item(t.id, 'u1')).toEqual(user('u1', 'AAAA'))
      await expect(t.host.prepare('no-such-session')).rejects.toThrow('会话不存在')
    } finally {
      await t.host.shutdown()
    }
  })

  it('读的间隙里追加的（没载入时加提示、补录）读进来，位置也记上', async () => {
    const t = await saved()
    try {
      const reading = t.host.prepare(t.id)
      await tick()
      expect(t.runtimes.size).toBe(0)
      t.host.addNotice(t.id, 'warn', '读的时候加的')
      t.store.appendItem(t.id, user('u2', 'BBBB'))
      await reading
      const items = t.host.open(t.id).items
      expect(items.slice(-2)).toMatchObject([
        { kind: 'notice', text: '读的时候加的' },
        { id: 'u2', cut: true },
      ])
      expect(t.host.item(t.id, 'u2')).toEqual(user('u2', 'BBBB'))
    } finally {
      await t.host.shutdown()
    }
  })

  it('读完时文件大小和读到的对不上：同步重读，不丢那一条', async () => {
    const t = await saved()
    const real = t.store.loadItemsAsync.bind(t.store)
    vi.spyOn(t.store, 'loadItemsAsync').mockImplementation(async (id, chunk) => {
      const got = await real(id, chunk)
      t.store.appendItem(id, plain('late'))
      return got
    })
    const sync = vi.spyOn(t.store, 'loadItems')
    try {
      await t.host.prepare(t.id)
      expect(sync).toHaveBeenCalledTimes(1)
      expect(t.host.open(t.id).items.at(-1)?.id).toBe('late')
    } finally {
      await t.host.shutdown()
    }
  })

  it('读的期间别的同步调用建了运行时：读完不替换它，也不盖掉它跟着回退、追加更新的位置', async () => {
    const t = await saved()
    try {
      const reading = t.host.prepare(t.id)
      t.host.open(t.id)
      const rt = t.runtimes.get(t.id)
      // 像回退那样重写文件，再来一条新的：位置都在新文件里
      t.store.replaceItems(t.id, t.host.open(t.id).items.slice(0, 1))
      ;(t.host as unknown as Apply).m.events.apply(t.id, { type: 'item_completed', item: user('u3', 'CCCC') })
      await reading
      expect(t.runtimes.get(t.id)).toBe(rt)
      expect(t.host.open(t.id).items.at(-1)).toMatchObject({ id: 'u3', cut: true })
      expect(t.host.item(t.id, 'u3')).toEqual(user('u3', 'CCCC'))
    } finally {
      await t.host.shutdown()
    }
  })
})
