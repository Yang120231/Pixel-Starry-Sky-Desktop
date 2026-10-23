// 频道协作第二版第一批（docs/ui/channels-collab-v2.md §1、§3、§5）：讨论串、频道工具、提议、交接、成员的扩展设置
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineEvent, HostEvent, ProjectRecord, SessionSummary } from '@pixelsky/protocol'
import type { AgentInput, ChannelTask, ChannelTextMessage } from '../../../shared/types/channels'
import { ChannelStore } from './store'
import { Channels, SELF_ID } from './service'

const projects: ProjectRecord[] = [
  { id: 'p1', name: 'pixel-web', path: 'D:/web' } as ProjectRecord,
  { id: 'ssh-ab~p2', name: 'build', path: '/srv/build' } as ProjectRecord,
]

let dir: string
let now: number
let opened: Channels[]
let calls: { channel: string; args: unknown[] }[]
let sessions: SessionSummary[]

const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2))
    for (const c of opened) await (c as unknown as { store: ChannelStore }).store.flush()
  }
}

async function open(channelTools = true): Promise<Channels> {
  const store = new ChannelStore(dir)
  await store.init()
  let n = 0
  const c = new Channels({
    store,
    call: async (channel, args) => {
      calls.push({ channel, args })
      if (channel === 'engine:createSession') {
        const o = args[0] as { projectId: string }
        const prefix = o.projectId.includes('~') ? o.projectId.slice(0, o.projectId.indexOf('~') + 1) : ''
        const id = `${prefix}s${++n}`
        sessions.push({ record: { id, projectId: o.projectId }, state: 'idle' } as SessionSummary)
        return { id }
      }
      if (channel === 'engine:send')
        return { queueId: (args[1] as { clientMessageId: string }).clientMessageId, status: 'queued' }
      return null
    },
    emit: () => {},
    machines: () => [
      { id: 'local', name: 'PC', connected: true },
      { id: 'ssh-ab', name: 'build', connected: true },
    ],
    projects: () => projects,
    sessions: () => sessions,
    machineOf: id => (/^ssh-[a-f0-9-]+~/.test(id) ? id.slice(0, id.indexOf('~')) : 'local'),
    selfName: () => '林夏',
    locale: () => 'zh-CN',
    now: () => ++now,
    channelTools,
  })
  opened.push(c)
  return c
}

const agent = (name: string, patch: Partial<AgentInput> = {}): AgentInput => ({
  name,
  engine: 'claude',
  projectId: 'p1',
  copyId: null,
  settings: {},
  instructions: '',
  mode: 'per-task',
  ...patch,
})
const sends = () =>
  calls
    .filter(c => c.channel === 'engine:send')
    .map(c => ({ sessionId: c.args[0] as string, ...(c.args[1] as { text: string; clientMessageId: string }) }))
const tasks = (c: Channels, id: string) => c.messages(id).messages.filter((m): m is ChannelTask => m.kind === 'task')
const texts = (c: Channels, id: string) =>
  c.messages(id).messages.filter((m): m is ChannelTextMessage => m.kind === 'message')
const ev = (sessionId: string, event: EngineEvent): HostEvent => ({ kind: 'session', sessionId, seq: 0, event })

function finishLast(c: Channels, reply: string): void {
  const s = sends().at(-1)!
  const turn = `turn-${s.clientMessageId}`
  c.hostEvent(
    ev(s.sessionId, {
      type: 'item_completed',
      item: { kind: 'user', id: s.clientMessageId, text: '', createdAt: 0, turnId: turn },
    }),
  )
  c.hostEvent(
    ev(s.sessionId, {
      type: 'item_completed',
      item: { kind: 'assistant', id: `a-${turn}`, text: reply, status: 'completed' },
    }),
  )
  c.hostEvent(ev(s.sessionId, { type: 'turn_completed', turnId: turn, outcome: 'completed', error: null }))
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pixelsky-collab-'))
  now = 1_000_000
  opened = []
  calls = []
  sessions = []
})
afterEach(async () => {
  for (const c of opened) await c.dispose()
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe('讨论串（§3）', () => {
  it('串里不 @ 只是留言；@ 同一成员 = 追加要求；@ 别人开新卡；在串里的消息再开串归到原来的串', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const b = await c.saveMember(null, agent('审查员'))
    const ch = await c.create({ name: 'web', memberIds: [a, b] })
    await c.post(ch, { text: '@前端 改按钮', clientId: '1' })
    await settle()
    const card = tasks(c, ch)[0]
    finishLast(c, '改好了')
    await settle()

    const note = await c.post(ch, { text: '颜色再深一点也行', threadId: card.id, clientId: '2' })
    expect(note.tasks).toEqual([])
    expect(note.message.threadId).toBe(card.id)
    expect(sends()).toHaveLength(1)

    const more = await c.post(ch, { text: '@前端 禁用状态也改', threadId: card.id, clientId: '3' })
    await settle()
    expect(more.tasks).toEqual([card.id])
    expect(sends()).toHaveLength(2)
    expect(sends()[1].sessionId).toBe(sends()[0].sessionId)
    expect(tasks(c, ch)[0].round).toBe(2)

    const other = await c.post(ch, { text: '@审查员 看一下', threadId: note.message.id, clientId: '4' })
    await settle()
    expect(other.message.threadId).toBe(card.id)
    expect(tasks(c, ch)).toHaveLength(2)
    expect(tasks(c, ch)[1].assigneeId).toBe(b)
    // 别处来的串 id 不认
    const stray = await c.post(ch, { text: '随便说一句', threadId: 'nope', clientId: '5' })
    expect(stray.message.threadId).toBeUndefined()
  })
})

describe('频道工具（§1）', () => {
  it('本机成员：提示词只带最近 5 条并说明工具；SSH 机器上的成员和没开工具时照旧带 20 条', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const r = await c.saveMember(null, agent('构建', { projectId: 'ssh-ab~p2' }))
    const ch = await c.create({ name: 'web', memberIds: [a, r] })
    for (let i = 0; i < 8; i++) await c.post(ch, { text: `第 ${i} 句`, clientId: `m${i}` })
    await c.post(ch, { text: '@前端 @构建 开工', clientId: 'go' })
    await settle()
    const [local, remote] = sends()
    expect(local.text).toContain('你有频道工具（MCP 服务 pixelsky_channel）')
    expect(local.text).toContain('第 7 句')
    expect(local.text).not.toContain('第 2 句')
    expect(remote.text).not.toContain('pixelsky_channel')
    expect(remote.text).toContain('第 0 句')
    expect(c.sessionMember(local.sessionId)).toEqual({ memberId: a, tools: null })
    expect(c.sessionMember(remote.sessionId)).toBeNull()
    expect(c.sessionMember('other')).toBeNull()
  })

  it('channel_read 翻页、channel_reply 发在这项活的串里、thread_read 读串；不是频道会话时报错', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const ch = await c.create({ name: 'web', memberIds: [a] })
    for (let i = 0; i < 5; i++) await c.post(ch, { text: `第 ${i} 句`, clientId: `m${i}` })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    const s = sends()[0].sessionId
    const card = tasks(c, ch)[0]

    const last = c.toolRead(s, { limit: 2 })
    expect(last).toContain('林夏：@前端 改按钮')
    expect(last).toContain('[任务卡 id=' + card.id)
    expect(last).not.toContain('第 4 句')
    const firstId = texts(c, ch)[1].id
    const page = c.toolRead(s, { before: firstId })
    expect(page).toContain('第 0 句')
    expect(page).toContain('前面没有了')

    expect(await c.toolReply(s, '先改「账号」页')).toContain('改按钮')
    const reply = texts(c, ch).at(-1)!
    expect(reply).toMatchObject({ authorId: a, threadId: card.id, format: 'markdown', mentions: [] })
    // 串里的话不上主时间线的读取
    expect(c.toolRead(s, {})).not.toContain('先改「账号」页')
    expect(c.toolThread(s)).toContain('前端：先改「账号」页')
    expect(c.toolRead(s, {})).toContain('串里 1 条')

    expect(() => c.toolRead('other', {})).toThrow('不是频道派活的会话')
    await expect(c.toolReply(s, '  ')).rejects.toThrow('不能为空')
  })

  it('task_propose 发提议卡（@你），点「派出去」才派，派活人是你；不要了就不派；名字不对报可选的成员', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const b = await c.saveMember(null, agent('文档'))
    const ch = await c.create({ name: 'web', memberIds: [a, b] })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    const s = sends()[0].sessionId
    await expect(c.toolPropose(s, '后端', '改接口')).rejects.toThrow('可以选：文档')
    await expect(c.toolPropose(s, '前端', '改接口')).rejects.toThrow('不能交给你自己')

    expect(await c.toolPropose(s, '@文档', '更新 README 截图')).toContain('等用户决定')
    const proposal = texts(c, ch).at(-1)!
    expect(proposal).toMatchObject({
      authorId: a,
      mentions: [SELF_ID],
      proposal: { assigneeId: b, request: '更新 README 截图', state: 'open' },
    })
    expect(tasks(c, ch)).toHaveLength(1)

    const taskId = await c.proposal(ch, proposal.id, true)
    await settle()
    expect(tasks(c, ch)[1]).toMatchObject({ id: taskId, authorId: SELF_ID, assigneeId: b, title: '更新 README 截图' })
    expect(sends().at(-1)!.text).toContain('这次的要求：\n更新 README 截图')
    expect(texts(c, ch).find(m => m.id === proposal.id)?.proposal).toMatchObject({ state: 'sent', taskId })
    // 再点不重复派
    expect(await c.proposal(ch, proposal.id, true)).toBe(taskId)
    expect(tasks(c, ch)).toHaveLength(2)

    await c.toolPropose(s, '文档', '顺便改 CHANGELOG')
    const second = texts(c, ch).at(-1)!
    expect(await c.proposal(ch, second.id, false)).toBeNull()
    expect(texts(c, ch).at(-1)?.proposal?.state).toBe('dismissed')
    expect(tasks(c, ch)).toHaveLength(2)
  })

  it('task_handover：没开互相派活时报错；开了直接交出去，算接力；回复里再 @ 同一个人不重复派', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端'))
    const b = await c.saveMember(null, agent('审查员'))
    const ch = await c.create({ name: 'web', memberIds: [a, b] })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    const s = sends()[0].sessionId
    await expect(c.toolHandover(s, '审查员', '看一下')).rejects.toThrow('task_propose')

    await c.update(ch, { relay: true })
    expect(await c.toolHandover(s, '审查员', '先看一下样式')).toContain('已交给 审查员')
    await settle()
    const [orig, relay] = tasks(c, ch)
    expect(relay).toMatchObject({ authorId: a, assigneeId: b, relay: { chain: orig.id, hop: 1, held: null } })
    expect(texts(c, ch).at(-1)).toMatchObject({ authorId: a, threadId: orig.id, mentions: [b] })
    const handed = sends().at(-1)!
    expect(handed.text).toContain('前端 在做「改按钮」，把这部分交给了你。')
    expect(handed.text).not.toContain('的回复：')
    await expect(c.toolHandover(s, '审查员', '再看')).rejects.toThrow('已经交给过')

    // 前端做完，回复里又 @ 了审查员：已经交过，不再开卡
    const frontSend = sends().find(x => x.sessionId === s)!
    const turn = `turn-${frontSend.clientMessageId}`
    c.hostEvent(
      ev(s, {
        type: 'item_completed',
        item: { kind: 'user', id: frontSend.clientMessageId, text: '', createdAt: 0, turnId: turn },
      }),
    )
    c.hostEvent(
      ev(s, {
        type: 'item_completed',
        item: { kind: 'assistant', id: 'a1', text: '改好了。\n\n@审查员 看一下', status: 'completed' },
      }),
    )
    c.hostEvent(ev(s, { type: 'turn_completed', turnId: turn, outcome: 'completed', error: null }))
    await settle()
    expect(tasks(c, ch)).toHaveLength(2)
  })
})

describe('成员的扩展设置（§5）', () => {
  it('只用这些：去重存下 id，乱写当跟随全局；频道会话按成员给出；从已有会话加入的成员不筛', async () => {
    const c = await open()
    const a = await c.saveMember(
      null,
      agent('前端', { tools: { mode: 'only', ids: ['mcp-1', 'skill-2', 'mcp-1', 3 as unknown as string] } }),
    )
    const b = await c.saveMember(null, agent('文档', { tools: { mode: 'all' } as unknown as AgentInput['tools'] }))
    const members = c.state().members
    expect(members.find(m => m.id === a)).toMatchObject({
      config: { tools: { mode: 'only', ids: ['mcp-1', 'skill-2'] } },
    })
    const docs = members.find(m => m.id === b)
    expect(docs?.kind === 'agent' && docs.config?.tools).toBeUndefined()

    const ch = await c.create({ name: 'web', memberIds: [a] })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    expect(c.sessionMember(sends()[0].sessionId)).toEqual({
      memberId: a,
      tools: { mode: 'only', ids: ['mcp-1', 'skill-2'] },
    })

    // 改回跟随全局
    await c.saveMember(null, { ...agent('前端'), id: a, tools: null })
    expect(c.sessionMember(sends()[0].sessionId)).toEqual({ memberId: a, tools: null })
  })

  it('没开频道工具（测试 / 旧接线）：会话不算频道会话，提示词照旧', async () => {
    const c = await open(false)
    const a = await c.saveMember(null, agent('前端'))
    const ch = await c.create({ name: 'web', memberIds: [a] })
    await c.post(ch, { text: '@前端 改按钮', clientId: 'go' })
    await settle()
    expect(sends()[0].text).not.toContain('pixelsky_channel')
    expect(c.sessionMember(sends()[0].sessionId)).toBeNull()
  })
})
