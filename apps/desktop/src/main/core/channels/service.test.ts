import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineEvent, HostEvent, ProjectRecord, SessionSnapshot, SessionSummary } from '@pixelsky/protocol'
import type { AgentInput, ChannelTask, ChannelTextMessage } from '../../../shared/types/channels'
import { ChannelStore } from './store'
import { Channels, SELF_ID, type MachineLite } from './service'

/** 等派活的异步步骤（新建会话、写盘、发送）都走完 */
const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2))
    for (const c of opened) await (c as unknown as { store: ChannelStore }).store.flush()
  }
}

/** 假引擎：记下调用，会话列表跟着新建 / 删除变 */
function fakeEngine() {
  const calls: { channel: string; args: unknown[] }[] = []
  const sessions: SessionSummary[] = []
  const snapshots = new Map<string, SessionSnapshot>()
  let n = 0
  const fail = new Map<string, string>()
  const call = async (channel: string, args: unknown[]): Promise<unknown> => {
    calls.push({ channel, args })
    if (fail.has(channel)) throw new Error(fail.get(channel))
    if (channel === 'engine:createSession') {
      const o = args[0] as { projectId: string }
      const prefix = o.projectId.includes('~') ? o.projectId.slice(0, o.projectId.indexOf('~') + 1) : ''
      const id = `${prefix}s${++n}`
      sessions.push({ record: { id, projectId: o.projectId }, state: 'idle' } as SessionSummary)
      return { id }
    }
    if (channel === 'engine:openSession') {
      const snapshot = snapshots.get(args[0] as string)
      if (!snapshot) throw new Error('会话不存在')
      return { snapshot, seq: 1 }
    }
    if (channel === 'engine:send')
      return { queueId: (args[1] as { clientMessageId: string }).clientMessageId, status: 'queued' }
    return null
  }
  const sends = () =>
    calls
      .filter(c => c.channel === 'engine:send')
      .map(c => ({ sessionId: c.args[0] as string, ...(c.args[1] as { text: string; clientMessageId: string }) }))
  return { calls, sessions, snapshots, call, sends, fail }
}

const projects: ProjectRecord[] = [
  { id: 'p1', name: 'pixel-web', path: 'D:/web' } as ProjectRecord,
  { id: 'ssh-ab~p2', name: 'build', path: '/srv/build' } as ProjectRecord,
]

let dir: string
let engine: ReturnType<typeof fakeEngine>
let machines: MachineLite[]
let now: number
let emitted: { channel: string; value: unknown }[]
let opened: Channels[]

async function open(): Promise<Channels> {
  const store = new ChannelStore(dir)
  await store.init()
  const c = new Channels({
    store,
    call: engine.call,
    emit: (channel, value) => emitted.push({ channel, value }),
    machines: () => machines,
    projects: () => projects,
    sessions: () => engine.sessions,
    machineOf: id => (/^ssh-[a-f0-9-]+~/.test(id) ? id.slice(0, id.indexOf('~')) : 'local'),
    selfName: () => '林夏',
    locale: () => 'zh-CN',
    now: () => ++now,
  })
  opened.push(c)
  return c
}

const agent = (name: string, patch: Partial<AgentInput> = {}): AgentInput => ({
  name,
  engine: 'claude',
  projectId: 'p1',
  copyId: null,
  settings: { permissionMode: 'ask' },
  instructions: '',
  mode: 'per-task',
  ...patch,
})

const ev = (sessionId: string, event: EngineEvent): HostEvent => ({ kind: 'session', sessionId, seq: 0, event })
const userItem = (cmid: string, turnId: string): EngineEvent => ({
  type: 'item_completed',
  item: { kind: 'user', id: cmid, text: '', createdAt: 0, turnId },
})
/** 让一轮从开始做到完成 */
function complete(c: Channels, sessionId: string, cmid: string, reply: string, turn = `turn-${cmid}`): void {
  c.hostEvent(ev(sessionId, userItem(cmid, turn)))
  c.hostEvent(
    ev(sessionId, {
      type: 'item_completed',
      item: { kind: 'assistant', id: `a-${turn}`, text: reply, status: 'completed' },
    }),
  )
  c.hostEvent(ev(sessionId, { type: 'turn_completed', turnId: turn, outcome: 'completed', error: null }))
}
const tasks = (c: Channels, channelId: string) =>
  c.messages(channelId).messages.filter((m): m is ChannelTask => m.kind === 'task')
const texts = (c: Channels, channelId: string) =>
  c.messages(channelId).messages.filter((m): m is ChannelTextMessage => m.kind === 'message')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pixelsky-channels-'))
  engine = fakeEngine()
  machines = [{ id: 'local', name: 'PC', connected: true }]
  now = 1_000_000
  emitted = []
  opened = []
})
afterEach(async () => {
  for (const c of opened) await c.dispose()
  await rm(dir, { recursive: true, force: true })
})

describe('协作频道：派活', () => {
  it('@成员 → 新开会话、改名、发提示词；做完后结果发回频道，任务卡更新摘要 / 改动 / 需要你决定', async () => {
    const c = await open()
    const memberId = await c.saveMember(null, agent('前端助手', { instructions: '只改前端' }))
    const channelId = await c.create({ name: '网页版改版', topic: '10 月', memberIds: [memberId] })
    const { tasks: ids } = await c.post(channelId, { text: '@前端助手 把设置页迁到新表单', clientId: 'x1' })
    await settle()
    expect(ids).toHaveLength(1)
    const create = engine.calls.find(x => x.channel === 'engine:createSession')!
    expect(create.args[0]).toEqual({ projectId: 'p1', engine: 'claude', permissionMode: 'ask' })
    expect(engine.calls.find(x => x.channel === 'engine:renameSession')?.args).toEqual(['s1', '把设置页迁到新表单'])
    const [send] = engine.sends()
    expect(send.sessionId).toBe('s1')
    expect(send.clientMessageId).toBe(`ch-${ids[0]}-1`)
    expect(send.text).toContain('#网页版改版')
    expect(send.text).toContain('只改前端')
    expect(tasks(c, channelId)[0]).toMatchObject({ status: 'queued', sessionId: 's1', title: '把设置页迁到新表单' })
    expect(c.state().members.find(m => m.id === memberId)).toMatchObject({
      status: 'running',
      task: '把设置页迁到新表单',
    })

    c.hostEvent(ev('s1', userItem(send.clientMessageId, 'k')))
    expect(tasks(c, channelId)[0].status).toBe('running')
    c.hostEvent(
      ev('s1', {
        type: 'item_completed',
        item: {
          kind: 'file_change',
          id: 'f',
          status: 'completed',
          changes: [{ path: 'a.tsx', kind: 'update', diff: '', added: 42, removed: 10 }],
        },
      }),
    )
    c.hostEvent(
      ev('s1', {
        type: 'item_completed',
        item: { kind: 'assistant', id: 'a', text: '改好了设置页。\n\n需要你决定：删旧组件吗？', status: 'completed' },
      }),
    )
    c.hostEvent(ev('s1', { type: 'turn_completed', turnId: 'k', outcome: 'completed', error: null }))
    const task = tasks(c, channelId)[0]
    expect(task).toMatchObject({
      status: 'done',
      summary: '改好了设置页。',
      decision: '删旧组件吗？',
      diff: { added: 42, removed: 10 },
    })
    const result = texts(c, channelId).at(-1)!
    expect(result).toMatchObject({
      authorId: memberId,
      format: 'markdown',
      replyToId: task.id,
      taskId: task.id,
      mentions: [SELF_ID],
    })
    // 结果算未读，带「需要你决定」算 @你
    expect(c.state().channels[0]).toMatchObject({ unread: 1, mentioned: true })
    c.markRead(channelId)
    expect(c.state().channels[0]).toMatchObject({ unread: 0, mentioned: false })
    expect(c.state().members.find(m => m.id === memberId)).toMatchObject({
      status: 'idle',
      stats: { total: 1, done: 1, failed: 0 },
    })
    expect(c.state().sessionChannels).toEqual({ s1: '网页版改版' })
  })

  it('同一个成员的活排队，前一项结束后自动开始；不同成员同时做', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端助手'))
    const b = await c.saveMember(null, agent('审查员', { engine: 'codex' }))
    const channelId = await c.create({ name: 'ch', memberIds: [a, b] })
    await c.post(channelId, { text: '@前端助手 @审查员 第一项', clientId: '1' })
    await c.post(channelId, { text: '@前端助手 第二项', clientId: '2' })
    await settle()
    expect(engine.sends().map(s => s.sessionId)).toEqual(['s1', 's2'])
    const [first, review, second] = tasks(c, channelId)
    expect(review.assigneeId).toBe(b)
    expect(second).toMatchObject({ status: 'queued', ahead: 1, sessionId: null })
    complete(c, 's1', `ch-${first.id}-1`, '完成')
    await settle()
    // 每项活新开会话
    expect(engine.sends().at(-1)).toMatchObject({ sessionId: 's3', clientMessageId: `ch-${second.id}-1` })
    expect(tasks(c, channelId)[2]).toMatchObject({ ahead: 0, sessionId: 's3' })
  })

  it('一直用同一个会话：第二项活发到同一个会话，只补上次之后的讨论', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('文档助手', { mode: 'shared' }))
    const channelId = await c.create({ name: 'ch', memberIds: [a] })
    await c.post(channelId, { text: '早先的讨论', clientId: '0' })
    await c.post(channelId, { text: '@文档助手 第一项', clientId: '1' })
    await settle()
    expect(engine.calls.find(x => x.channel === 'engine:renameSession')?.args).toEqual(['s1', '文档助手'])
    complete(c, 's1', `ch-${tasks(c, channelId)[0].id}-1`, '好')
    await c.post(channelId, { text: '中间的话', clientId: '2' })
    await c.post(channelId, { text: '@文档助手 第二项', clientId: '3' })
    await settle()
    const send = engine.sends().at(-1)!
    expect(send.sessionId).toBe('s1')
    expect(send.text).toContain('中间的话')
    expect(send.text).not.toContain('早先的讨论')
  })

  it('回复任务卡 = 追加要求：做完后发到同一个会话，轮次加 1；还在做时等这一轮做完', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端助手'))
    const channelId = await c.create({ name: 'ch', memberIds: [a] })
    await c.post(channelId, { text: '@前端助手 改按钮', clientId: '1' })
    await settle()
    const task = tasks(c, channelId)[0]
    // 还在做：先记着
    await c.post(channelId, { text: '顺便改颜色', replyToId: task.id, clientId: '2' })
    expect(engine.sends()).toHaveLength(1)
    complete(c, 's1', `ch-${task.id}-1`, '改好了')
    await settle()
    expect(engine.sends().at(-1)).toMatchObject({ sessionId: 's1', clientMessageId: `ch-${task.id}-2` })
    expect(engine.sends().at(-1)!.text).toContain('顺便改颜色\n\n（来自频道 #ch，林夏）')
    complete(c, 's1', `ch-${task.id}-2`, '颜色也改了')
    // 回复结果消息也算追加要求
    const result = texts(c, channelId).at(-1)!
    await c.post(channelId, { text: '再加个图标', replyToId: result.id, clientId: '3' })
    await settle()
    expect(engine.sends().at(-1)).toMatchObject({ sessionId: 's1', clientMessageId: `ch-${task.id}-3` })
    expect(tasks(c, channelId)).toHaveLength(1)
    expect(tasks(c, channelId)[0]).toMatchObject({ round: 3, status: 'queued' })
    // 引用的同时 @ 了别的成员：给它开新活
    const b = await c.saveMember(channelId, agent('审查员'))
    await c.post(channelId, { text: '@审查员 帮忙看看', replyToId: result.id, clientId: '4' })
    await settle()
    expect(tasks(c, channelId).map(t => t.assigneeId)).toEqual([a, b])
    expect(engine.sends().at(-1)!.text).toContain('引用的消息：\n> 前端助手：颜色也改了')
  })

  it('重复提交同一条消息不重复派活', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端助手'))
    const channelId = await c.create({ name: 'ch', memberIds: [a] })
    await c.post(channelId, { text: '@前端助手 做', clientId: 'same' })
    await c.post(channelId, { text: '@前端助手 做', clientId: 'same' })
    await settle()
    expect(tasks(c, channelId)).toHaveLength(1)
    expect(texts(c, channelId)).toHaveLength(1)
  })
})

describe('协作频道：失败、停止、重试', () => {
  it('机器没连上 → 失败；重试时还没开始的原样再发，做到一半的发「继续」', async () => {
    machines.push({ id: 'ssh-ab', name: 'build-01', connected: false })
    const c = await open()
    const a = await c.saveMember(null, agent('构建助手', { projectId: 'ssh-ab~p2' }))
    expect(c.state().members.find(m => m.id === a)).toMatchObject({
      status: 'offline',
      machineId: 'ssh-ab',
      machine: 'build-01',
    })
    const channelId = await c.create({ name: 'ch', memberIds: [a] })
    await c.post(channelId, { text: '@构建助手 打包', clientId: '1' })
    await settle()
    const task = tasks(c, channelId)[0]
    expect(task).toMatchObject({ status: 'failed', error: '机器「build-01」未连接' })
    machines[1].connected = true
    await c.taskAction(task.id, 'retry')
    await settle()
    const first = engine.sends()[0]
    expect(first).toMatchObject({ sessionId: 'ssh-ab~s1', clientMessageId: `ch-${task.id}-2` })
    expect(first.text).toContain('打包')
    // 开始后失败 → 重试发「继续」
    c.hostEvent(ev('ssh-ab~s1', userItem(first.clientMessageId, 'k')))
    c.hostEvent(
      ev('ssh-ab~s1', { type: 'turn_completed', turnId: 'k', outcome: 'failed', error: '502 Bad Gateway\nmore' }),
    )
    expect(tasks(c, channelId)[0]).toMatchObject({ status: 'failed', error: '502 Bad Gateway' })
    await c.taskAction(task.id, 'retry')
    await settle()
    expect(engine.sends().at(-1)).toMatchObject({
      sessionId: 'ssh-ab~s1',
      text: '继续',
      clientMessageId: `ch-${task.id}-3`,
    })
  })

  it('取消排队的活；停止进行中的活；会话被删 → 失败', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端助手'))
    const channelId = await c.create({ name: 'ch', memberIds: [a] })
    await c.post(channelId, { text: '@前端助手 一', clientId: '1' })
    await c.post(channelId, { text: '@前端助手 二', clientId: '2' })
    await settle()
    const [one, two] = tasks(c, channelId)
    await c.taskAction(two.id, 'cancel')
    expect(tasks(c, channelId)[1]).toMatchObject({ status: 'stopped', note: 'cancelled' })
    c.hostEvent(ev('s1', userItem(`ch-${one.id}-1`, 'k')))
    await c.taskAction(one.id, 'stop')
    expect(engine.calls.at(-1)).toEqual({ channel: 'engine:interruptTurn', args: ['s1', 'k'] })
    c.hostEvent(ev('s1', { type: 'turn_completed', turnId: 'k', outcome: 'interrupted', error: null }))
    expect(tasks(c, channelId)[0].status).toBe('stopped')
    // 再派一项，然后删会话
    await c.post(channelId, { text: '@前端助手 三', clientId: '3' })
    await settle()
    engine.sessions.splice(0)
    c.hostEvent({ kind: 'sessions', sessions: [] })
    expect(tasks(c, channelId)[2]).toMatchObject({ status: 'failed', error: '会话已删除' })
  })

  it('会话发送失败时卡片显示失败原因', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端助手'))
    const channelId = await c.create({ name: 'ch', memberIds: [a] })
    engine.fail.set('engine:send', '项目目录不存在')
    await c.post(channelId, { text: '@前端助手 做', clientId: '1' })
    await settle()
    expect(tasks(c, channelId)[0]).toMatchObject({ status: 'failed', error: '项目目录不存在' })
  })
})

describe('协作频道：存储与对账', () => {
  it('重启后消息、任务、成员都还在；没做完的按会话快照对账', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端助手'))
    const channelId = await c.create({ name: '网页版', memberIds: [a] })
    await c.post(channelId, { text: '@前端助手 改', clientId: '1' })
    await settle()
    const task = tasks(c, channelId)[0]
    c.hostEvent(ev('s1', userItem(`ch-${task.id}-1`, 'k')))
    await settle()
    await c.dispose()

    engine.snapshots.set('s1', {
      record: { id: 's1', lastOutcome: 'completed' },
      state: 'idle',
      turnId: null,
      pending: [],
      queue: [],
      items: [
        { kind: 'user', id: `ch-${task.id}-1`, text: '', createdAt: 0, turnId: 'k' },
        { kind: 'assistant', id: 'a', text: '离线时做完了', status: 'completed' },
      ],
    } as unknown as SessionSnapshot)
    const again = await open()
    expect(again.state().channels.map(x => x.name)).toEqual(['网页版'])
    expect(tasks(again, channelId)[0]).toMatchObject({ status: 'running', sessionId: 's1' })
    await again.reconcile()
    expect(tasks(again, channelId)[0]).toMatchObject({ status: 'done', summary: '离线时做完了' })
    expect(texts(again, channelId).at(-1)?.text).toBe('离线时做完了')
  })

  it('改名、改主题、移除成员、删除频道', async () => {
    const c = await open()
    const a = await c.saveMember(null, agent('前端助手'))
    const channelId = await c.create({ name: '旧名', memberIds: [a] })
    await expect(c.create({ name: '旧名' })).rejects.toThrow('已经有同名的频道')
    await expect(c.saveMember(null, agent('前端助手'))).rejects.toThrow('已经有同名的 AI 成员')
    await c.update(channelId, { name: '新名', topic: '主题' })
    await c.removeMember(channelId, a)
    const events = c
      .messages(channelId)
      .messages.filter(m => m.kind === 'event')
      .map(m => m.kind === 'event' && m.event)
    expect(events).toEqual(['added', 'renamed', 'topic', 'removed'])
    expect(c.state().channels[0]).toMatchObject({ name: '新名', topic: '主题', memberIds: [SELF_ID] })
    await c.deleteMember(a)
    expect(c.state().members.map(m => m.id)).toEqual([SELF_ID])
    await c.delete(channelId)
    expect(c.state().channels).toEqual([])
    const again = await open()
    expect(again.state().channels).toEqual([])
  })
})
