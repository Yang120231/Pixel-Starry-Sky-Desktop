// 没载入的会话（docs/session-memory.md 第 1 期）：只改记录的操作不建运行时（不把整份对话读进内存），
// 记录照样落盘、广播；已载入的照旧发会话事件
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApprovalRequest, EngineEvent, EngineId, HostEvent, Item, SessionRecord } from '@pixelsky/protocol'
import type { EngineAdapter } from '../src/adapter'
import { EngineHost } from '../src/host'
import { makeTmp, removeTmp } from './helpers/tmp'

let root: string
let host: EngineHost
let events: HostEvent[]
let adapters: Partial<Record<EngineId, EngineAdapter>>

const make = () => new EngineHost({ dataDir: join(root, 'data'), emit: e => events.push(e), adapters })
beforeEach(() => {
  root = makeTmp('unloaded')
  mkdirSync(join(root, 'project'))
  events = []
  adapters = {}
  host = make()
})
afterEach(async () => {
  await host.shutdown()
  removeTmp(root)
})

const reply = (id: string): Item => ({ kind: 'assistant', id, text: '回复', status: 'completed' })
const runtimes = () => (host as unknown as { runtimes: Map<string, unknown> }).runtimes
const sessionDir = (id: string) => join(root, 'data', 'sessions', id)
const saved = (id: string): SessionRecord => JSON.parse(readFileSync(join(sessionDir(id), 'record.json'), 'utf8'))
const itemIds = (id: string) =>
  existsSync(join(sessionDir(id), 'items.jsonl'))
    ? readFileSync(join(sessionDir(id), 'items.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(line => (JSON.parse(line) as Item).id)
    : []
const sessionEvents = (id: string) => events.filter(e => e.kind === 'session' && e.sessionId === id)
const lastList = () => events.filter(e => e.kind === 'sessions').at(-1)

/** 建会话（items 写进磁盘），可改记录字段；重开宿主，确保没有运行时 */
async function sessions(...specs: { items?: Item[]; patch?: Partial<SessionRecord> }[]): Promise<SessionRecord[]> {
  const project = host.addProject(join(root, 'project'))
  const records = specs.map(({ items = [], patch = {} }) => {
    const r = { ...host.createSession({ projectId: project.id }), ...patch }
    mkdirSync(sessionDir(r.id), { recursive: true })
    writeFileSync(join(sessionDir(r.id), 'record.json'), JSON.stringify(r))
    if (items.length)
      writeFileSync(join(sessionDir(r.id), 'items.jsonl'), items.map(i => JSON.stringify(i)).join('\n') + '\n')
    return r
  })
  await host.shutdown()
  host = make()
  events = []
  return records
}

describe('没载入的会话：只改记录', () => {
  it('改名、置顶、置底、归档：不建运行时，记录落盘并广播，不发会话事件', async () => {
    const [r] = await sessions({ items: [reply('a')] })
    expect(host.renameSession(r.id, '新名字').title).toBe('新名字')
    host.setSessionPinned(r.id, true)
    host.setSessionBottom(r.id, true)
    await host.archiveSession(r.id, true, true)
    expect(runtimes().size).toBe(0)
    expect(host.loaded(r.id)).toBeNull()
    expect(saved(r.id)).toMatchObject({ title: '新名字', titleEdited: true, pinnedAt: null })
    expect(saved(r.id).bottomedAt).toBeGreaterThan(0)
    expect(saved(r.id).archivedAt).toBeGreaterThan(0)
    expect(lastList()).toMatchObject({ sessions: [{ record: { id: r.id, title: '新名字' } }] })
    expect(sessionEvents(r.id)).toEqual([])
    // 打开时读到的是改过的记录和原来的条目
    expect(host.open(r.id)).toMatchObject({ record: { title: '新名字' }, items: [{ id: 'a' }] })
  })

  it('已载入的照旧发 record 会话事件，执行设置跟着改', async () => {
    const [r] = await sessions({ items: [reply('a')] })
    host.open(r.id)
    host.renameSession(r.id, '载入后改名')
    expect(sessionEvents(r.id)).toMatchObject([{ seq: 1, event: { type: 'record', record: { title: '载入后改名' } } }])
    expect(host.loaded(r.id)?.record.title).toBe('载入后改名')
  })

  it('不存在的会话照样报错', () => {
    expect(() => host.renameSession('nope', '名字')).toThrow('会话不存在')
    expect(() => host.setSessionPinned('nope', true)).toThrow('会话不存在')
    expect(() => host.addNotice('nope', 'warn', '提示')).toThrow('会话不存在')
  })

  it('加提示：没有条目的不加；有条目的只追加到磁盘', async () => {
    const [empty, full] = await sessions({}, { items: [reply('a')] })
    host.addNotice(empty.id, 'warn', '手机改了模式')
    host.addNotice(full.id, 'warn', '手机改了模式')
    expect(runtimes().size).toBe(0)
    expect(itemIds(empty.id)).toEqual([])
    expect(itemIds(full.id)).toHaveLength(2)
    expect(host.open(full.id).items.at(-1)).toMatchObject({ kind: 'notice', level: 'warn', text: '手机改了模式' })
  })

  it('合并回没载入的上级：卡片写进磁盘、摘要记在上级记录上，都不载入；不带摘要也不载入', async () => {
    const [parent] = await sessions({ items: [reply('a')] })
    const branch = {
      copyId: null,
      gitBranch: null,
      baseBranch: null,
      startCommit: null,
      startAfter: 'a',
      mergedAt: null,
    }
    const [child] = await sessions({
      items: [reply('a'), reply('b')],
      patch: { title: '试试', forkedFrom: { sessionId: parent.id, title: '上级' }, branch },
    })
    const merge = {
      sessionId: child.id,
      title: '试试',
      summary: '· 改成短信验证码',
      code: 'none' as const,
      files: [],
      copyRemoved: false,
      gitBranch: null,
    }
    host.recordMerge(child.id, merge, {})
    expect(runtimes().size).toBe(0)
    expect(saved(parent.id).pendingMerge).toEqual({ sessionId: child.id, title: '试试', summary: '· 改成短信验证码' })
    expect(saved(child.id).branch?.mergedAt).toBeGreaterThan(0)
    host.dropPendingMerge(parent.id)
    expect(runtimes().size).toBe(0)
    expect(saved(parent.id).pendingMerge).toBeNull()
    expect(host.open(parent.id).items.at(-1)).toMatchObject({ kind: 'notice', merge: { sessionId: child.id } })
  })

  it('旁聊只读记录，不载入会话', async () => {
    let asked: SessionRecord | null = null
    adapters.claude = {
      sideQuestion: async (record: SessionRecord) => {
        asked = record
        return '答'
      },
    } as unknown as EngineAdapter
    const [r] = await sessions({ items: [reply('a')], patch: { engine: 'claude', engineSessionId: 'native-1' } })
    expect(await host.sideQuestion(r.id, '问', [])).toBe('答')
    expect(asked).toMatchObject({ id: r.id, engineSessionId: 'native-1' })
    expect(runtimes().size).toBe(0)
  })

  it('维护工作目录：没载入的会话不载入，锁期间发不出去', async () => {
    const [a, , loaded] = await sessions({ items: [reply('a')] }, { items: [reply('b')] }, { items: [reply('c')] })
    host.open(loaded.id)
    await host.withWorkspaceStopped(join(root, 'project'), async () => {
      expect(runtimes().size).toBe(1)
      await expect(host.send(a.id, { text: '你好', clientMessageId: 'm1' })).rejects.toThrow('维护')
    })
  })
})

describe('会话列表的 pending', () => {
  const request = (requestId: string): ApprovalRequest => ({
    requestId,
    itemId: null,
    kind: 'command',
    title: '运行命令',
    command: 'ls',
    alwaysScopes: [],
  })

  it('已载入的会话带第一个待批准的请求；处理掉一个就广播下一个；没有时省略', async () => {
    const [r] = await sessions({ items: [reply('a')] })
    expect(host.sessions()[0]).not.toHaveProperty('pending')
    host.open(r.id)
    const on = (e: EngineEvent) =>
      (
        host as unknown as { m: { events: { onEngineEvent(id: string, e: EngineEvent): void } } }
      ).m.events.onEngineEvent(r.id, e)
    on({ type: 'approval_request', request: request('q1') })
    on({ type: 'approval_request', request: request('q2') })
    expect(host.sessions()[0]).toMatchObject({ pending: { requestId: 'q1' }, pendingIds: ['q1', 'q2'] })
    on({ type: 'approval_resolved', requestId: 'q1' })
    expect(lastList()).toMatchObject({ sessions: [{ pending: { requestId: 'q2' }, pendingIds: ['q2'] }] })
  })
})
