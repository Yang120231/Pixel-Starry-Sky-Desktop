import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineEvent, HostEvent, ProjectRecord, SessionSummary } from '@pixelsky/protocol'
import type { AgentInput, AgentMember, ChannelMessage, ChannelTask } from '../../../shared/types/channels'
import { ChannelStore } from './store'
import { Channels, SELF_ID } from './service'
import { TeamApi } from './team/api'
import { FakeCloud, until } from './team/fake-cloud'
import type { RealtimeStatus, TeamFrame } from './team/realtime'
import { TeamSync } from './team/sync'

const projects: ProjectRecord[] = [{ id: 'p1', name: 'pixel-web', path: 'D:/web' } as ProjectRecord]

let dir: string
let opened: Channels[]
let emitted: { channel: string; value: unknown }[]
let sent: { sessionId: string; text: string; clientMessageId: string }[]
let sessions: SessionSummary[]
let now: number

async function open() {
  const cloud = new FakeCloud()
  let handlers!: { onFrame(f: TeamFrame): void; onStatus(s: RealtimeStatus): void }
  const sync = new TeamSync({
    api: new TeamApi(cloud.fetch),
    realtime: h => {
      handlers = h
      return { start() {}, stop() {}, restart() {} }
    },
  })
  cloud.push = f => handlers.onFrame(f)
  const store = new ChannelStore(dir)
  await store.init()
  const c = new Channels({
    store,
    call: async (channel, args) => {
      if (channel === 'engine:createSession') {
        const id = `s${sessions.length + 1}`
        sessions.push({ record: { id, projectId: 'p1' }, state: 'idle' } as SessionSummary)
        return { id }
      }
      if (channel === 'engine:send')
        sent.push({ sessionId: args[0] as string, ...(args[1] as { text: string; clientMessageId: string }) })
      return null
    },
    emit: (channel, value) => emitted.push({ channel, value }),
    machines: () => [{ id: 'local', name: 'PC', connected: true }],
    projects: () => projects,
    sessions: () => sessions,
    machineOf: () => 'local',
    selfName: () => '林夏',
    locale: () => 'zh-CN',
    now: () => ++now,
    team: sync,
    deviceId: 'dev-A',
    machineName: () => '林夏的电脑',
    teamTiming: { progressMs: 10, statusMs: 10 },
  })
  opened.push(c)
  const online = async () => {
    sync.start()
    handlers.onStatus('online')
    await until(() => sync.connection() === 'online')
  }
  return { c, cloud, sync, store, online, status: (s: RealtimeStatus) => handlers.onStatus(s) }
}

const agent = (name: string, patch: Partial<AgentInput> = {}): AgentInput => ({
  name,
  engine: 'claude',
  projectId: 'p1',
  copyId: null,
  settings: { model: 'sonnet' },
  instructions: '只改前端',
  mode: 'per-task',
  ...patch,
})
const ev = (sessionId: string, event: EngineEvent): HostEvent => ({ kind: 'session', sessionId, seq: 0, event })
function complete(c: Channels, sessionId: string, cmid: string, reply: string): void {
  const turn = `turn-${cmid}`
  c.hostEvent(
    ev(sessionId, { type: 'item_completed', item: { kind: 'user', id: cmid, text: '', createdAt: 0, turnId: turn } }),
  )
  c.hostEvent(
    ev(sessionId, {
      type: 'item_completed',
      item: { kind: 'assistant', id: `a-${turn}`, text: reply, status: 'completed' },
    }),
  )
  c.hostEvent(ev(sessionId, { type: 'turn_completed', turnId: turn, outcome: 'completed', error: null }))
}
const pushes = (): ChannelMessage[] =>
  emitted.filter(e => e.channel === 'channels:message').map(e => (e.value as { message: ChannelMessage }).message)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pixelsky-channels-team-'))
  opened = []
  emitted = []
  sent = []
  sessions = []
  now = 1_000_000
})
afterEach(async () => {
  for (const c of opened) await c.dispose()
  await rm(dir, { recursive: true, force: true })
})

describe('协作频道 Phase C：快照合并', () => {
  it('state() 合并本机和团队；没登录时团队部分是空的', async () => {
    const { c, online } = await open()
    const local = await c.create({ name: '本机频道' })
    expect(c.state()).toMatchObject({ teams: [], invites: [], teamsConnection: 'signed-out', teamsSyncedAt: null })
    await online()
    const s = c.state()
    expect(s.teamsConnection).toBe('online')
    expect(s.teamsSyncedAt).toBeGreaterThan(0)
    expect(s.teams[0]).toMatchObject({ id: 'tm_1', role: 'owner' })
    expect(s.channels.map(x => [x.name, x.scope])).toEqual(
      expect.arrayContaining([
        ['本机频道', 'local'],
        ['更新日志', 'team'],
      ]),
    )
    expect(s.channels.find(x => x.id === local)?.teamId).toBeUndefined()
    expect(s.channels.find(x => x.scope === 'team')?.teamId).toBe('tm_1')
    // 本机自己仍是 you；团队里自己是 owner key，也带 you
    expect(s.self).toMatchObject({ id: SELF_ID, you: true })
    expect(s.members.find(m => m.id === 'u:1')).toMatchObject({ you: true, userId: 'u:1', kind: 'human' })
  })

  it('本机频道的读写不受团队影响（同步返回）', async () => {
    const { c, online } = await open()
    await online()
    const id = await c.create({ name: '本机' })
    const page = c.page(id)
    expect(page).not.toBeInstanceOf(Promise)
    await c.post(id, { text: '你好', clientId: 'a' })
    expect(c.page(id)).toMatchObject({ messages: [{ kind: 'message', text: '你好' }] })
  })
})

describe('协作频道 Phase C：团队频道分流', () => {
  it('发消息走云端（@ 解析按团队成员名），发了就算看过', async () => {
    const { c, cloud, online } = await open()
    await online()
    const { message, tasks } = await c.post('tc_1', { text: '@周宁 在吗', clientId: 'c1' })
    expect(tasks).toEqual([])
    expect(message).toMatchObject({ kind: 'message', text: '@周宁 在吗', mentions: ['u:2'] })
    const post = cloud.calls.find(x => x.method === 'POST' && x.path.endsWith('/messages'))!
    expect(post.body).toEqual({ client_id: 'c1', text: '@周宁 在吗', mentions: ['u:2'] })
    // 同一个 clientId 重复提交：云端返回同一条
    const again = await c.post('tc_1', { text: '@周宁 在吗', clientId: 'c1' })
    expect(again.message.id).toBe(message.id)
    const page = await c.page('tc_1')
    expect(page.messages.filter(m => m.kind === 'message')).toHaveLength(1)
    expect(pushes().some(m => m.id === message.id)).toBe(true)
  })

  it('观察者：@ AI 成员只当文字，不带 mentions', async () => {
    const { c, cloud, online } = await open()
    cloud.role = 'observer'
    cloud.addAgent('u:2', 'm-9', { policy: 'team' })
    await online()
    const { message } = await c.post('tc_1', { text: '@审查员 @周宁 看下', clientId: 'o1' })
    expect(message.mentions).toEqual(['u:2'])
    await expect(c.create({ name: '新频道', teamId: 'tm_1' })).rejects.toThrow('观察者')
    await expect(c.addMember('tc_1', 'x')).rejects.toThrow()
  })

  it('未读、已读：markRead 走云端', async () => {
    const { c, cloud, online } = await open()
    await online()
    cloud.userPost('u:2', 'tc_1', '@林夏 看看', ['u:1'])
    expect(c.state().channels.find(x => x.id === 'tc_1')).toMatchObject({ unread: 1, mentioned: true })
    expect(pushes().at(-1)).toMatchObject({ kind: 'message', mentions: ['u:1'], authorId: 'u:2' })
    c.markRead('tc_1')
    expect(c.state().channels.find(x => x.id === 'tc_1')).toMatchObject({ unread: 0, mentioned: false })
    await until(() => cloud.calls.some(x => x.path.endsWith('/read')))
  })

  it('建团队频道、改名、删除；建团队 / 邀请等走 /v1/teams', async () => {
    const { c, cloud, online } = await open()
    await online()
    const member = await c.saveMember(null, agent('前端助手'))
    const id = await c.create({ name: '设计评审', topic: '每周三', teamId: 'tm_1', memberIds: [member] })
    expect(cloud.channels.some(x => x.id === id && x.name === '设计评审' && x.topic === '每周三')).toBe(true)
    expect(cloud.agents.map(a => a.local_id)).toContain(member)
    await c.update(id, { name: '设计评审会', topic: null })
    expect(cloud.channels.find(x => x.id === id)).toMatchObject({ name: '设计评审会', topic: null })
    await c.delete(id)
    expect(cloud.channels.some(x => x.id === id)).toBe(false)
    await c.createTeam('新团队')
    await c.invite('tm_1', 'Wang@Example.com', 'observer')
    await c.respondInvite('iv_1', true)
    await c.setRole('tm_1', 'u:2', 'observer')
    await c.removeTeamMember('tm_1', 'u:2')
    await c.renameSelf('tm_1', '小林')
    const calls = cloud.calls.filter(x => x.method !== 'GET').map(x => `${x.method} ${x.path}`)
    expect(calls).toEqual(
      expect.arrayContaining([
        'POST /v1/teams',
        'POST /v1/teams/tm_1/invites',
        'POST /v1/invites/iv_1/accept',
        'PATCH /v1/teams/tm_1/members/u%3A2',
        'DELETE /v1/teams/tm_1/members/u%3A2',
        'PATCH /v1/teams/tm_1/me',
      ]),
    )
    expect(cloud.calls.find(x => x.path === '/v1/teams/tm_1/invites')?.body).toEqual({
      email: 'wang@example.com',
      role: 'observer',
    })
    await expect(c.invite('tm_1', '不是邮箱', 'member')).rejects.toThrow('邮箱')
  })

  it('加 AI 成员 = 登记自己的成员（默认「要我同意」），改派活规则，移出', async () => {
    const { c, cloud, sync, online } = await open()
    await online()
    const member = await c.saveMember(null, agent('前端助手'))
    await c.addMember('tc_1', member)
    const put = cloud.calls.find(x => x.method === 'PUT')!
    expect(put.path).toBe(`/v1/teams/tm_1/channels/tc_1/agents/${member}`)
    expect(put.body).toEqual({
      name: '前端助手',
      engine: 'claude',
      model: 'sonnet',
      machine: '林夏的电脑',
      project: 'pixel-web',
      policy: 'approve',
    })
    const view = c.state().members.find(m => m.kind === 'agent' && m.teamAgentId) as AgentMember
    expect(view).toMatchObject({ mine: true, policy: 'approve', ownerId: 'u:1', status: 'idle' })
    expect(view.config?.id).toBe(member)
    // 再加一次不重复登记（也不把规则改回去）
    await c.setAgentPolicy('tc_1', view.id, 'team')
    expect(cloud.agent(view.id)?.policy).toBe('team')
    await c.addMember('tc_1', member)
    expect(cloud.agents).toHaveLength(1)
    expect(cloud.agent(view.id)?.policy).toBe('team')
    await expect(c.setAgentPolicy('tc_1', 'ta_999', 'team')).rejects.toThrow('自己的')
    await c.removeMember('tc_1', view.id)
    expect(cloud.agents).toHaveLength(0)
    expect(sync.agentById(view.id)).toBeUndefined()
  })

  it('删除本机 AI 成员时一并撤下团队频道里的登记', async () => {
    const { c, cloud, online } = await open()
    await online()
    const member = await c.saveMember(null, agent('前端助手'))
    await c.addMember('tc_1', member)
    await c.deleteMember(member)
    expect(cloud.agents).toHaveLength(0)
  })
})

describe('协作频道 Phase C：执行端复用 Phase B', () => {
  async function ready(policy: 'approve' | 'team') {
    const t = await open()
    await t.online()
    const member = await t.c.saveMember(null, agent('前端助手'))
    await t.c.addMember('tc_1', member)
    const view = t.c.state().members.find(m => m.kind === 'agent' && (m as AgentMember).teamAgentId) as AgentMember
    if (policy === 'team') await t.c.setAgentPolicy('tc_1', view.id, 'team')
    return { ...t, member, agentId: view.id }
  }

  it('别人 @ 我的成员（团队成员可直接派活）：认领 → 开会话 → 进度 → 结果发回频道 → 卡片完成', async () => {
    const { c, cloud, agentId } = await ready('team')
    const { tasks } = cloud.userPost('u:2', 'tc_1', '@前端助手 把设置页迁到新表单', [agentId])
    const id = tasks[0].id as string
    await until(() => sent.length === 1)
    expect(cloud.task(id)).toMatchObject({ claimed_by: 'dev-A' })
    expect(sent[0].clientMessageId).toBe(`ch-${id}-1`)
    expect(sent[0].text).toContain('周宁')
    expect(sent[0].text).toContain('把设置页迁到新表单')
    expect(sent[0].text).toContain('只改前端')
    // 会话标题、侧栏「# 频道名」
    expect(c.state().sessionChannels).toEqual({ s1: '更新日志' })
    // 引擎开始做 → 云端卡片 running；主人这边的卡片带会话
    c.hostEvent(
      ev('s1', {
        type: 'item_completed',
        item: { kind: 'user', id: sent[0].clientMessageId, text: '', createdAt: 0, turnId: 'k' },
      }),
    )
    await until(() => cloud.task(id).status === 'running')
    const page = await c.page('tc_1')
    expect(page.messages.find(m => m.id === id)).toMatchObject({ status: 'running', sessionId: 's1', ownerId: 'u:1' })
    // 做完
    c.hostEvent(
      ev('s1', {
        type: 'item_completed',
        item: {
          kind: 'assistant',
          id: 'a',
          text: '迁完了。\n\n改了 3 个文件。\n\n需要你决定：是否合并旧表单',
          status: 'completed',
        },
      }),
    )
    c.hostEvent(ev('s1', { type: 'turn_completed', turnId: 'k', outcome: 'completed', error: null }))
    await until(() => cloud.task(id).status === 'done')
    expect(cloud.task(id)).toMatchObject({ summary: '迁完了。', decision: '是否合并旧表单', error: null })
    const result = cloud.messages.get('tc_1')!.find(m => m.author === agentId && m.task_id === id)!
    expect(result.text).toContain('迁完了')
    expect(result.mentions).toEqual(['u:2'])
    // 结果和卡片更新都推给了界面
    expect(pushes().some(m => m.kind === 'message' && m.authorId === agentId && m.taskId === id)).toBe(true)
    expect(
      pushes()
        .filter(m => m.id === id)
        .map(m => (m as ChannelTask).status),
    ).toContain('done')
  })

  it('要我同意：卡片停在 approval，同意后才开工；拒绝则已停止', async () => {
    const { c, cloud, agentId } = await ready('approve')
    const a = cloud.userPost('u:2', 'tc_1', '@前端助手 重构 A', [agentId]).tasks[0].id as string
    const b = cloud.userPost('u:2', 'tc_1', '@前端助手 重构 B', [agentId]).tasks[0].id as string
    await new Promise(r => setTimeout(r, 60))
    expect(sent).toHaveLength(0)
    expect(pushes().find(m => m.id === a)).toMatchObject({ status: 'approval', ownerId: 'u:1', assigneeId: agentId })
    await c.approveTask(b, false)
    expect(cloud.task(b)).toMatchObject({ status: 'stopped', note: 'rejected' })
    await c.approveTask(a, true)
    await until(() => sent.length === 1)
    expect(sent[0].clientMessageId).toBe(`ch-${a}-1`)
    expect(cloud.task(a).claimed_by).toBe('dev-A')
  })

  it('同一个成员的活排队：前面做完才做下一项', async () => {
    const { c, cloud, agentId } = await ready('team')
    const a = cloud.userPost('u:2', 'tc_1', '@前端助手 第一件', [agentId]).tasks[0].id as string
    const b = cloud.userPost('u:2', 'tc_1', '@前端助手 第二件', [agentId]).tasks[0].id as string
    await until(() => sent.length === 1)
    await new Promise(r => setTimeout(r, 60))
    expect(sent).toHaveLength(1)
    complete(c, 's1', sent[0].clientMessageId, '第一件做完了')
    await until(() => sent.length === 2)
    expect(sent[1].clientMessageId).toBe(`ch-${b}-1`)
    await until(() => cloud.task(a).status === 'done')
  })

  it('别人点「取消」排队中的活：本机取消并清掉请求；成员状态上报云端', async () => {
    const { c, cloud, agentId } = await ready('team')
    const a = cloud.userPost('u:2', 'tc_1', '@前端助手 第一件', [agentId]).tasks[0].id as string
    const b = cloud.userPost('u:2', 'tc_1', '@前端助手 第二件', [agentId]).tasks[0].id as string
    await until(() => sent.length === 1)
    await until(() => cloud.agent(agentId)?.status === 'running')
    expect(cloud.agent(agentId)?.task).toBe('第一件')
    await c.page('tc_1')
    await c.taskAction(b, 'cancel')
    expect(cloud.calls.some(x => x.path === `/v1/teams/tm_1/tasks/${b}/action`)).toBe(true)
    await until(() => cloud.task(b).status === 'stopped')
    expect(cloud.task(b)).toMatchObject({ note: 'cancelled', pending_action: null })
    complete(c, 's1', sent[0].clientMessageId, '好了')
    await until(() => cloud.task(a).status === 'done')
    await until(() => cloud.agent(agentId)?.status === 'idle')
  })

  it('做的时候别人追加要求：做完接着发下一轮', async () => {
    const { c, cloud, store, agentId } = await ready('team')
    const a = cloud.userPost('u:2', 'tc_1', '@前端助手 第一件', [agentId]).tasks[0].id as string
    await until(() => sent.length === 1)
    c.hostEvent(
      ev('s1', {
        type: 'item_completed',
        item: { kind: 'user', id: sent[0].clientMessageId, text: '', createdAt: 0, turnId: 'k' },
      }),
    )
    await until(() => cloud.task(a).status === 'running')
    cloud.userPost('u:3', 'tc_1', '再加个测试', [], a)
    // 观察者追加要求不算：云端不改卡片
    expect(cloud.task(a).round).toBe(1)
    cloud.userPost('u:2', 'tc_1', '顺便加个测试', [], a)
    await until(() => cloud.task(a).round === 2)
    // 执行端认领、取到追加的那条消息后才攒进本机运行记录；等它攒好再让这一轮结束（全量跑时机器忙，40ms 不一定够）
    await until(() => store.runs.get(a)?.followUps.length === 1)
    // 还在做：云端卡片被写回「进行中」
    await until(() => cloud.task(a).status === 'running')
    c.hostEvent(
      ev('s1', {
        type: 'item_completed',
        item: { kind: 'assistant', id: 'a1', text: '第一轮做完', status: 'completed' },
      }),
    )
    c.hostEvent(ev('s1', { type: 'turn_completed', turnId: 'k', outcome: 'completed', error: null }))
    await until(() => sent.length === 2)
    expect(sent[1].clientMessageId).toBe(`ch-${a}-2`)
    expect(sent[1].text).toContain('顺便加个测试')
    expect(sent[1].sessionId).toBe('s1')
    await until(() => cloud.task(a).round === 2 && cloud.task(a).status !== 'done')
  })

  it('重启后：运行信息还在，按会话快照对账并写回云端', async () => {
    const first = await ready('team')
    const a = first.cloud.userPost('u:2', 'tc_1', '@前端助手 第一件', [first.agentId]).tasks[0].id as string
    await until(() => sent.length === 1)
    first.c.hostEvent(
      ev('s1', {
        type: 'item_completed',
        item: { kind: 'user', id: sent[0].clientMessageId, text: '', createdAt: 0, turnId: 'k' },
      }),
    )
    await until(() => first.cloud.task(a).status === 'running')
    await first.c.dispose()
    // 重启：同一个本机目录、同一个云端
    const store = new ChannelStore(dir)
    await store.init()
    expect(store.runs.get(a)?.team).toMatchObject({ teamId: 'tm_1', messageId: a })
    expect(store.runs.get(a)?.phase).toBe('sent')
  })
})
