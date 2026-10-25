// 流程（docs/ui/channels-pipeline.md §4）接进频道服务：依赖调度、task_done、审查打回、member_ask、拆流程、没交付的提醒
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineEvent, HostEvent, ProjectRecord, SessionSummary, UsageRecord } from '@pixelsky/protocol'
import type { AgentInput, ChannelFlow, ChannelTask, ChannelTextMessage } from '../../../shared/types/channels'
import { ChannelStore } from './store'
import { Channels, type ChannelsDeps } from './service'

const projects: ProjectRecord[] = [{ id: 'p1', name: 'pixel-web', path: 'D:/web' } as ProjectRecord]

let dir: string
let now: number
let opened: Channels[]
let calls: { channel: string; args: unknown[] }[]
let sessions: SessionSummary[]
/** 假的用量记录（engine:usageList 按 filter.session 取） */
let usage: UsageRecord[]

const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2))
    for (const c of opened) await (c as unknown as { store: ChannelStore }).store.flush()
  }
}

async function open(extra: Partial<ChannelsDeps> = {}): Promise<Channels> {
  const store = new ChannelStore(dir)
  await store.init()
  let n = 0
  const c = new Channels({
    store,
    call: async (channel, args) => {
      calls.push({ channel, args })
      if (channel === 'engine:createSession') {
        const id = `s${++n}`
        sessions.push({ record: { id, projectId: 'p1' }, state: 'idle' } as SessionSummary)
        return { id }
      }
      if (channel === 'engine:send')
        return { queueId: (args[1] as { clientMessageId: string }).clientMessageId, status: 'queued' }
      if (channel === 'engine:usageList') {
        const q = args[0] as { filter: { session: string }; offset: number; limit: number }
        const all = usage.filter(r => r.sessionId === q.filter.session)
        return { records: all.slice(q.offset, q.offset + q.limit), total: all.length, offset: q.offset }
      }
      return null
    },
    emit: () => {},
    machines: () => [{ id: 'local', name: 'PC', connected: true }],
    projects: () => projects,
    sessions: () => sessions,
    machineOf: () => 'local',
    selfName: () => '林夏',
    locale: () => 'zh-CN',
    now: () => ++now,
    channelTools: true,
    alertTimer: false,
    ...extra,
  })
  opened.push(c)
  return c
}

const agent = (name: string): AgentInput => ({
  name,
  engine: 'claude',
  projectId: 'p1',
  copyId: null,
  settings: {},
  instructions: '',
  mode: 'per-task',
})
const sends = () =>
  calls
    .filter(c => c.channel === 'engine:send')
    .map(c => ({ sessionId: c.args[0] as string, ...(c.args[1] as { text: string; clientMessageId: string }) }))
const lastTo = (s: string) =>
  sends()
    .filter(x => x.sessionId === s)
    .at(-1)!
const tasks = (c: Channels, id: string) => c.messages(id).messages.filter((m): m is ChannelTask => m.kind === 'task')
const flowOf = (c: Channels, id: string): ChannelFlow =>
  c.messages(id).messages.find((m): m is ChannelTextMessage => m.kind === 'message' && !!m.flow)!.flow!
const stepOf = (c: Channels, ch: string, id: string) => flowOf(c, ch).steps.find(s => s.id === id)!
const sessionOf = (c: Channels, ch: string, stepId: string) =>
  tasks(c, ch).find(t => t.flow?.stepId === stepId)!.sessionId!
const ev = (sessionId: string, event: EngineEvent): HostEvent => ({ kind: 'session', sessionId, seq: 0, event })

/** 这个会话最后收到的那条消息这一轮做完，回复 reply */
async function endTurn(c: Channels, s: string, reply: string): Promise<void> {
  const x = lastTo(s)
  const turn = `turn-${x.clientMessageId}`
  c.hostEvent(
    ev(s, {
      type: 'item_completed',
      item: { kind: 'user', id: x.clientMessageId, text: '', createdAt: 0, turnId: turn },
    }),
  )
  c.hostEvent(
    ev(s, { type: 'item_completed', item: { kind: 'assistant', id: `a-${turn}`, text: reply, status: 'completed' } }),
  )
  c.hostEvent(ev(s, { type: 'turn_completed', turnId: turn, outcome: 'completed', error: null }))
  await settle()
}

async function setup(extra: Partial<ChannelsDeps> = {}) {
  const c = await open(extra)
  const a = await c.saveMember(null, agent('画师'))
  const b = await c.saveMember(null, agent('程序员'))
  const r = await c.saveMember(null, agent('审查员'))
  const ch = await c.create({ name: 'web', memberIds: [a, b, r] })
  return { c, a, b, r, ch }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pixelsky-flow-'))
  now = 1_000_000
  opened = []
  calls = []
  sessions = []
  usage = []
})
afterEach(async () => {
  for (const c of opened) await c.dispose()
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe('流程调度', () => {
  it('① 交付 → ② 带着 ① 的结果开始 → ③ 打回 → ② 第 2 轮 → ③ 再审通过 → ④ 汇总 → 流程完成', async () => {
    const { c, a, b, r, ch } = await setup()
    const { messageId } = await c.flowAction(ch, {
      type: 'create',
      title: '登录页新按钮',
      steps: [
        { id: 's1', title: '画贴图', memberId: a, deps: [], kind: 'work' },
        { id: 's2', title: '写代码', memberId: b, deps: ['s1'], kind: 'work', settings: { effort: 'high' } },
        { id: 's3', title: '审查代码', memberId: r, deps: [], kind: 'review', target: 's2' },
        { id: 's4', title: '汇总', memberId: r, deps: ['s3'], kind: 'summary' },
      ],
    })
    await expect(c.flowAction(ch, { type: 'resume', messageId })).resolves.toEqual({ messageId })
    await c.flowAction(ch, { type: 'start', messageId })
    await settle()
    expect(sends()).toHaveLength(1)
    const s1 = sessionOf(c, ch, 's1')
    expect(lastTo(s1).text).toContain('→ ① 画贴图 · 画师 · 进行中')
    expect(c.toolDone(s1, { summary: '贴图画好了', files: ['assets/btn.png'] })).toContain('已交付')
    expect(() => c.toolDone(s1, { summary: '再交一次' })).toThrow('已经交付过了')
    await endTurn(c, s1, '画好了')
    // 迟到的调用不记到别的卡上
    expect(() => c.toolDone(s1, { summary: '晚了' })).toThrow('不在流程里')
    expect(stepOf(c, ch, 's1')).toMatchObject({ status: 'delivered', result: { summary: '贴图画好了' } })

    const s2 = sessionOf(c, ch, 's2')
    expect(lastTo(s2).text).toContain('① 画贴图（画师）：贴图画好了')
    expect(lastTo(s2).text).toContain('assets/btn.png')
    // 这一步的临时设置用在新开的会话上
    const created = calls.filter(x => x.channel === 'engine:createSession').map(x => x.args[0] as { effort?: string })
    expect(created[1].effort).toBe('high')
    c.toolDone(s2, { summary: '按钮写好了' })
    await endTurn(c, s2, '写好了')

    const s3 = sessionOf(c, ch, 's3')
    expect(lastTo(s3).text).toContain('审查 ②「写代码」')
    expect(() => c.toolDone(s3, { summary: '有问题' })).toThrow('verdict')
    expect(() => c.toolDone(s3, { summary: '有问题', verdict: 'reject' })).toThrow('issues')
    c.toolDone(s3, { summary: '有问题', verdict: 'reject', issues: ['按钮没对齐'] })
    await endTurn(c, s3, '打回')
    expect(stepOf(c, ch, 's2')).toMatchObject({ status: 'running', rejects: 1 })
    expect(stepOf(c, ch, 's3').status).toBe('pending')
    expect(lastTo(s2).text).toContain('1. 按钮没对齐')
    expect(lastTo(s2).text).toContain('第 1 / 3 次')

    c.toolDone(s2, { summary: '对齐了' })
    await endTurn(c, s2, '改好了')
    // 再审用原来那张卡、原来的会话
    expect(tasks(c, ch).filter(t => t.flow?.stepId === 's3')).toHaveLength(1)
    expect(lastTo(s3).text).toContain('按你的意见改过了')
    expect(lastTo(s3).text).toContain('对齐了')
    c.toolDone(s3, { summary: '没问题了', verdict: 'pass' })
    await endTurn(c, s3, '通过')

    const s4 = sessionOf(c, ch, 's4')
    expect(s4).not.toBe(s3)
    const prompt = lastTo(s4).text
    expect(prompt).toContain('这是最后一步')
    expect(prompt).toContain('贴图画好了')
    expect(prompt).toContain('对齐了')
    c.toolDone(s4, { summary: '都做完了' })
    await endTurn(c, s4, '总结')
    expect(flowOf(c, ch).status).toBe('done')
    // 步骤的回复里提到同事不另外派活
    expect(tasks(c, ch)).toHaveLength(4)
  })

  it('做完了没 task_done：提醒一次；第二次还没有就停下，出现在「需要你」里；继续后再提醒', async () => {
    const { c, a, ch } = await setup()
    const { messageId } = await c.flowAction(ch, {
      type: 'create',
      title: '画图',
      steps: [{ id: 's1', title: '画贴图', memberId: a, deps: [], kind: 'work' }],
    })
    await c.flowAction(ch, { type: 'start', messageId })
    await settle()
    const s1 = sessionOf(c, ch, 's1')
    await endTurn(c, s1, '画好了')
    expect(lastTo(s1).text).toContain('还没有调用 task_done')
    expect(sends()).toHaveLength(2)
    await endTurn(c, s1, '真的画好了')
    expect(sends()).toHaveLength(2)
    expect(flowOf(c, ch)).toMatchObject({ status: 'paused', paused: { reason: 'no-delivery', stepId: 's1' } })
    expect(c.state().needs?.some(n => n.kind === 'flow' && n.pause === 'no-delivery')).toBe(true)

    await c.flowAction(ch, { type: 'resume', messageId })
    await settle()
    expect(sends()).toHaveLength(3)
    c.toolDone(s1, { summary: '好了' })
    await endTurn(c, s1, '好了')
    expect(flowOf(c, ch).status).toBe('done')
  })

  it('member_ask：对方在做时等它这一轮做完再答；回答转给提问的人；对方空闲时马上答', async () => {
    const { c, a, b, ch } = await setup()
    const { messageId } = await c.flowAction(ch, {
      type: 'create',
      title: '并行',
      steps: [
        { id: 's1', title: '画贴图', memberId: a, deps: [], kind: 'work' },
        { id: 's2', title: '写代码', memberId: b, deps: [], kind: 'work' },
      ],
    })
    await c.flowAction(ch, { type: 'start', messageId })
    await settle()
    const s1 = sessionOf(c, ch, 's1')
    const s2 = sessionOf(c, ch, 's2')
    await expect(c.toolAsk(s2, '程序员', '自己问自己')).rejects.toThrow('不能交给你自己')
    expect(await c.toolAsk(s2, '画师', '按钮多大？')).toContain('问题已发给 画师')
    await expect(c.toolAsk(s2, '画师', '再问')).rejects.toThrow('已经问过')
    await endTurn(c, s2, '等回答')
    expect(stepOf(c, ch, 's2').status).toBe('asking')
    // 画师还在做：问题排在它这一轮后面
    expect(sends().filter(x => x.sessionId === s1)).toHaveLength(1)
    c.toolDone(s1, { summary: '贴图好了' })
    await endTurn(c, s1, '画好了')
    expect(lastTo(s1).text).toContain('程序员（流程里的另一个成员）问你')
    expect(lastTo(s1).text).toContain('按钮多大？')
    // 回答的那一轮不能 task_done
    expect(() => c.toolDone(s1, { summary: 'x' })).toThrow('回答别的成员')
    await endTurn(c, s1, '48 像素')
    expect(stepOf(c, ch, 's1').status).toBe('delivered')
    expect(stepOf(c, ch, 's2').status).toBe('running')
    expect(lastTo(s2).text).toContain('画师 的回答')
    expect(lastTo(s2).text).toContain('48 像素')

    // 画师已经交付、空闲：马上答
    const before = sends().length
    await c.toolAsk(s2, '画师', '颜色呢？')
    await settle()
    expect(sends()).toHaveLength(before + 1)
    expect(lastTo(s1).text).toContain('颜色呢？')
    expect(flowOf(c, ch).asks).toHaveLength(2)
  })

  it('让成员拆流程：交回的步骤成为草稿，成员名字不对时报错让它改；SSH 之外的校验沿用草稿校验', async () => {
    const { c, a, ch } = await setup()
    const { messageId } = await c.flowAction(ch, {
      type: 'create',
      title: '登录页',
      planner: { memberId: a, request: '做一个登录页新按钮' },
    })
    await settle()
    expect(flowOf(c, ch)).toMatchObject({ status: 'planning' })
    const s = tasks(c, ch)[0].sessionId!
    expect(lastTo(s).text).toContain('做一个登录页新按钮')
    expect(lastTo(s).text).toContain('- 程序员')
    expect(() => c.toolDone(s, { summary: '拆好了', steps: [{ title: '写', member: '路人' }] })).toThrow('不在频道里')
    c.toolDone(s, {
      summary: '拆好了',
      steps: [
        { title: '写代码', member: '程序员' },
        { title: '审查', member: '审查员', kind: 'review', target: 1 },
      ],
    })
    await endTurn(c, s, '拆好了')
    const f = flowOf(c, ch)
    expect(f.status).toBe('draft')
    expect(f.steps.map(x => [x.title, x.deps])).toEqual([
      ['写代码', []],
      ['审查', ['s1']],
    ])
    await expect(c.flowAction(ch, { type: 'discard', messageId })).resolves.toEqual({ messageId })
    expect(flowOf(c, ch).status).toBe('stopped')
  })

  it('打回到上限时你已经点了暂停：照样记成「打回到上限」，继续后再打回一次；交付后卡上的追加要求不改交付', async () => {
    const { c, a, r, ch } = await setup()
    const { messageId } = await c.flowAction(ch, {
      type: 'create',
      title: '审查循环',
      steps: [
        { id: 's1', title: '写代码', memberId: a, deps: [], kind: 'work' },
        { id: 's2', title: '审查', memberId: r, deps: [], kind: 'review', target: 's1' },
      ],
    })
    await c.flowAction(ch, { type: 'start', messageId })
    await settle()
    const s1 = sessionOf(c, ch, 's1')
    for (let i = 0; i < 4; i++) {
      c.toolDone(s1, { summary: `第 ${i + 1} 版` })
      await endTurn(c, s1, '写好了')
      const s2 = sessionOf(c, ch, 's2')
      c.toolDone(s2, { summary: '不行', verdict: 'reject', issues: ['还是不对'] })
      if (i === 3) await c.flowAction(ch, { type: 'pause', messageId })
      await endTurn(c, s2, '打回')
    }
    expect(flowOf(c, ch)).toMatchObject({ status: 'paused', paused: { reason: 'reject-limit', stepId: 's2' } })
    expect(stepOf(c, ch, 's1')).toMatchObject({ status: 'delivered', rejects: 3 })
    await c.flowAction(ch, { type: 'resume', messageId })
    await settle()
    expect(lastTo(s1).text).toContain('第 4 / 4 次')
    expect(stepOf(c, ch, 's1')).toMatchObject({ status: 'running', rejects: 4 })

    c.toolDone(s1, { summary: '第 5 版' })
    await endTurn(c, s1, '写好了')
    const s2 = sessionOf(c, ch, 's2')
    c.toolDone(s2, { summary: '可以了', verdict: 'pass' })
    await endTurn(c, s2, '通过')
    expect(flowOf(c, ch).status).toBe('done')
    // 流程完成后在交付过的卡上追加要求：流程不动
    const card = tasks(c, ch).find(t => t.flow?.stepId === 's1')!
    await c.post(ch, { text: '@画师 顺便加个注释', threadId: card.id, clientId: 'more' })
    await settle()
    expect(() => c.toolDone(s1, { summary: 'x' })).toThrow('已经交付过了')
    await endTurn(c, s1, '加好了')
    expect(flowOf(c, ch).status).toBe('done')
    expect(stepOf(c, ch, 's1').result?.summary).toBe('第 5 版')
  })

  it('不是流程里的活调用 task_done 报错；草稿有问题时不能开始', async () => {
    const { c, a, ch } = await setup()
    await c.post(ch, { text: '@画师 画个图', clientId: 'x' })
    await settle()
    expect(() => c.toolDone(sends()[0].sessionId, { summary: 'x' })).toThrow('不在流程里')
    const { messageId } = await c.flowAction(ch, {
      type: 'create',
      title: '空',
      steps: [{ id: 's1', title: '', memberId: a, deps: [], kind: 'work' }],
    })
    await expect(c.flowAction(ch, { type: 'start', messageId })).rejects.toThrow('还没写要做什么')
  })
})

describe('流程第二批（docs/ui/channels-pipeline.md §6）', () => {
  it('人工关卡：交付后等你确认，下游不开始；打回要写原因，同一张卡再来一轮；通过后接着走', async () => {
    const { c, a, b, ch } = await setup()
    const { messageId } = await c.flowAction(ch, {
      type: 'create',
      title: '先看贴图',
      steps: [
        { id: 's1', title: '画贴图', memberId: a, deps: [], kind: 'work', gate: true },
        { id: 's2', title: '写代码', memberId: b, deps: ['s1'], kind: 'work' },
      ],
    })
    await c.flowAction(ch, { type: 'start', messageId })
    await settle()
    const s1 = sessionOf(c, ch, 's1')
    c.toolDone(s1, { summary: '三张按钮图' })
    await endTurn(c, s1, '画好了')
    expect(stepOf(c, ch, 's1').status).toBe('gated')
    expect(tasks(c, ch).some(t => t.flow?.stepId === 's2')).toBe(false)
    expect(c.state().needs?.some(n => n.pause === 'gate' && n.stepId === 's1')).toBe(true)
    await expect(c.flowAction(ch, { type: 'gate', messageId, stepId: 's1', decision: 'reject' })).rejects.toThrow(
      '写一句',
    )
    await c.flowAction(ch, { type: 'gate', messageId, stepId: 's1', decision: 'reject', note: '按钮再圆一点' })
    await settle()
    expect(lastTo(s1).text).toContain('按钮再圆一点')
    expect(stepOf(c, ch, 's1').status).toBe('running')
    c.toolDone(s1, { summary: '改圆了' })
    await endTurn(c, s1, '改好了')
    expect(stepOf(c, ch, 's1').status).toBe('gated')
    // 等你确认等了很久：时长不算，通过后接着走
    now += 300 * 60_000
    await c.checkAlerts()
    expect(flowOf(c, ch).status).toBe('running')
    await c.flowAction(ch, { type: 'gate', messageId, stepId: 's1', decision: 'approve' })
    await settle()
    expect(stepOf(c, ch, 's1').status).toBe('delivered')
    expect(flowOf(c, ch).status).toBe('running')
    expect(lastTo(sessionOf(c, ch, 's2')).text).toContain('改圆了')
    await expect(c.flowAction(ch, { type: 'gate', messageId, stepId: 's1', decision: 'approve' })).rejects.toThrow(
      '不在等你确认',
    )
  })

  it('停止流程时等你确认的步骤也停下', async () => {
    const { c, a, ch } = await setup()
    const { messageId } = await c.flowAction(ch, {
      type: 'create',
      title: '停',
      steps: [{ id: 's1', title: '画贴图', memberId: a, deps: [], kind: 'work', gate: true }],
    })
    await c.flowAction(ch, { type: 'start', messageId })
    await settle()
    const s1 = sessionOf(c, ch, 's1')
    c.toolDone(s1, { summary: '好了' })
    await endTurn(c, s1, '好了')
    await c.flowAction(ch, { type: 'stop', messageId })
    expect(stepOf(c, ch, 's1').status).toBe('stopped')
    expect(c.state().needs?.some(n => n.pause === 'gate')).toBe(false)
  })

  it('护栏：轮次到上限就停下，继续再给一整份；时长超了巡检时停下', async () => {
    const { c, a, b, ch } = await setup()
    const { messageId } = await c.flowAction(ch, {
      type: 'create',
      title: '护栏',
      limits: { rounds: 2, minutes: null },
      steps: [
        { id: 's1', title: '画贴图', memberId: a, deps: [], kind: 'work' },
        { id: 's2', title: '写代码', memberId: b, deps: ['s1'], kind: 'work' },
      ],
    })
    await c.flowAction(ch, { type: 'start', messageId })
    await settle()
    const s1 = sessionOf(c, ch, 's1')
    c.toolDone(s1, { summary: '好了' })
    await endTurn(c, s1, '好了')
    const s2 = sessionOf(c, ch, 's2')
    // 用了 2 轮：没交付时不再提醒，停在护栏上
    await endTurn(c, s2, '写了一半')
    expect(flowOf(c, ch)).toMatchObject({ status: 'paused', paused: { reason: 'limit', limit: 'rounds' } })
    const before = sends().length
    await c.flowAction(ch, { type: 'resume', messageId })
    await settle()
    expect(sends()).toHaveLength(before + 1)
    expect(lastTo(s2).text).toContain('还没有调用 task_done')
    expect(flowOf(c, ch).since?.rounds).toBe(2)
    c.toolDone(s2, { summary: '写完了' })
    await endTurn(c, s2, '写完了')
    expect(flowOf(c, ch).status).toBe('done')

    // 没设护栏的按默认上限开始；时长到了巡检时停下
    const other = await c.flowAction(ch, {
      type: 'create',
      title: '时长',
      steps: [{ id: 's1', title: '慢活', memberId: a, deps: [], kind: 'work' }],
    })
    await c.flowAction(ch, { type: 'start', messageId: other.messageId })
    await settle()
    const f = c.messages(ch).messages.find(m => m.id === other.messageId) as ChannelTextMessage
    expect(f.flow?.limits).toEqual({ rounds: 12, minutes: 120 })
    now += 121 * 60_000
    await c.checkAlerts()
    const g = c.messages(ch).messages.find(m => m.id === other.messageId) as ChannelTextMessage
    expect(g.flow?.paused).toMatchObject({ reason: 'limit', limit: 'time' })
  })

  it('并行的步骤各用一个副本；汇总在主目录合并，主目录有改动时先停下；做完删副本；交付的文件规整成相对路径', async () => {
    let dirty = true
    const created: { name: string; branch: string; base: string }[] = []
    const removed: string[] = []
    const { c, a, b, r, ch } = await setup({
      copies: {
        create: async (_projectId, input) => {
          created.push(input)
          return { id: `c${created.length}`, branch: input.branch, path: `D:/copies/${input.name}` }
        },
        remove: async id => void removed.push(id),
        dirty: async () => dirty,
      },
    })
    const { messageId } = await c.flowAction(ch, {
      type: 'create',
      title: '并行',
      steps: [
        { id: 's1', title: '画贴图', memberId: a, deps: [], kind: 'work' },
        { id: 's2', title: '写代码', memberId: b, deps: [], kind: 'work' },
        { id: 's3', title: '合并汇总', memberId: r, deps: ['s1', 's2'], kind: 'summary' },
      ],
    })
    await c.flowAction(ch, { type: 'start', messageId })
    await settle()
    const tag = messageId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)
    expect(created.map(x => [x.branch, x.base])).toEqual([
      [`pixelsky/flow-${tag}-a`, ''],
      [`pixelsky/flow-${tag}-b`, ''],
    ])
    const sessionsMade = calls
      .filter(x => x.channel === 'engine:createSession')
      .map(x => x.args[0] as { copyId?: string })
    expect(sessionsMade.map(x => x.copyId)).toEqual(['c1', 'c2'])
    const s1 = sessionOf(c, ch, 's1')
    expect(lastTo(s1).text).toContain(`分支 pixelsky/flow-${tag}-a`)
    expect(stepOf(c, ch, 's1').copy).toMatchObject({ id: 'c1' })
    const reply = c.toolDone(s1, {
      summary: '图好了',
      files: [`D:/copies/flow-${tag}-a/img/btn.png`, '../x', 'C:/other/y'],
    })
    expect(reply).toContain('没有记下')
    await endTurn(c, s1, '好了')
    expect(stepOf(c, ch, 's1').result?.files).toEqual(['img/btn.png'])
    const s2 = sessionOf(c, ch, 's2')
    c.toolDone(s2, { summary: '代码好了' })
    await endTurn(c, s2, '好了')
    // 主目录有没提交的改动：汇总这一步先不开始
    expect(flowOf(c, ch)).toMatchObject({ status: 'paused', paused: { reason: 'dirty', stepId: 's3' } })
    dirty = false
    await c.flowAction(ch, { type: 'resume', messageId })
    await settle()
    const s3 = sessionOf(c, ch, 's3')
    const last = calls.filter(x => x.channel === 'engine:createSession').at(-1)!.args[0] as { copyId?: string }
    expect(last.copyId).toBeUndefined()
    expect(lastTo(s3).text).toContain(`pixelsky/flow-${tag}-a`)
    expect(lastTo(s3).text).toContain('git merge --no-ff')
    // 上一轮没开成会话就失败了：重试时提示词只发一遍
    expect(lastTo(s3).text.split('这是最后一步').length).toBe(2)
    c.toolDone(s3, { summary: '合好了' })
    await endTurn(c, s3, '合好了')
    expect(flowOf(c, ch).status).toBe('done')
    await settle()
    expect(removed.sort()).toEqual(['c1', 'c2'])
  })
})

describe('流程第三批（docs/ui/channels-pipeline.md §8）', () => {
  it('任务卡记下真正开始的时间（第一轮，不含排队）', async () => {
    const { c, a, ch } = await setup()
    const { messageId } = await c.flowAction(ch, {
      type: 'create',
      title: '计时',
      steps: [{ id: 's1', title: '画贴图', memberId: a, deps: [], kind: 'work' }],
    })
    await c.flowAction(ch, { type: 'start', messageId })
    await settle()
    const s1 = sessionOf(c, ch, 's1')
    expect(tasks(c, ch)[0].startedAt ?? null).toBeNull()
    c.toolDone(s1, { summary: '好了' })
    await endTurn(c, s1, '好了')
    const card = tasks(c, ch)[0]
    expect(card.startedAt).toBeGreaterThan(card.at)
    expect(card.endedAt).toBeGreaterThan(card.startedAt!)
  })

  it('牵头成员：不带 @ 的需求自动拆成流程；一次只拆一个；@、太短、斜杠、讨论串不触发；直接回答时不留草稿', async () => {
    const { c, a, b, ch } = await setup()
    await expect(c.update(ch, { lead: 'nobody' })).rejects.toThrow('牵头成员')
    // 没设牵头：只是留言
    await c.post(ch, { text: '帮我把登录页改成两步验证', clientId: 'p0' })
    await settle()
    expect(sends()).toHaveLength(0)

    await c.update(ch, { lead: a })
    expect(c.state().channels.find(x => x.id === ch)?.lead).toBe(a)
    await c.post(ch, { text: '好的', clientId: 'p1' })
    await c.post(ch, { text: '/compact 现在整理一下上下文', clientId: 'p2' })
    await settle()
    expect(sends()).toHaveLength(0)

    await c.post(ch, { text: '帮我把登录页改成两步验证', clientId: 'p3' })
    await c.post(ch, { text: '顺便把注册页也改了吧谢谢', clientId: 'p4' })
    await settle()
    const flows = () => c.messages(ch).messages.filter((m): m is ChannelTextMessage => m.kind === 'message' && !!m.flow)
    expect(flows()).toHaveLength(1)
    expect(flows()[0].flow).toMatchObject({ status: 'planning', planner: { memberId: a, auto: true } })
    expect(tasks(c, ch)[0].title).toContain('牵头处理')
    const s = tasks(c, ch)[0].sessionId!
    expect(lastTo(s).text).toContain('你是这个频道的牵头成员')

    // 只是问题：不调 task_done 直接回答，流程不留草稿
    await endTurn(c, s, '两步验证用短信验证码就行。')
    expect(flows()[0].flow?.status).toBe('stopped')

    // 有 @ 的照常派活，不交给牵头
    await c.post(ch, { text: '@程序员 写一下单元测试吧', clientId: 'p5' })
    await settle()
    expect(flows()).toHaveLength(1)
    expect(tasks(c, ch).at(-1)?.assigneeId).toBe(b)

    // 再来一条需求：这次拆成步骤，变成草稿等你确认
    await c.post(ch, { text: '做一个新的设置页并且审查一遍', clientId: 'p6' })
    await settle()
    const planning = tasks(c, ch).at(-1)!
    expect(planning.assigneeId).toBe(a)
    c.toolDone(planning.sessionId!, { summary: '拆好了', steps: [{ title: '写设置页', member: '程序员' }] })
    await endTurn(c, planning.sessionId!, '拆好了')
    expect(flows().at(-1)?.flow?.status).toBe('draft')

    // 讨论串里的不触发
    await c.post(ch, { text: '这个设置页也要支持深色主题', threadId: planning.id, clientId: 'p7' })
    await settle()
    expect(flows()).toHaveLength(2)

    // 牵头被移出频道：设置清掉
    await c.removeMember(ch, a)
    expect(c.state().channels.find(x => x.id === ch)?.lead).toBeNull()
  })
})

describe('流程第四批（docs/ui/channels-pipeline.md §10）', () => {
  /** 这个会话最后一轮的用量记录 */
  const record = (s: string, costUsd: number | null, input = 100): UsageRecord =>
    ({
      id: `${s}:turn-${lastTo(s).clientMessageId}:m`,
      sessionId: s,
      turnId: `turn-${lastTo(s).clientMessageId}`,
      model: 'm',
      engine: 'claude',
      input,
      cacheRead: 0,
      cacheWrite: 0,
      output: 10,
      costUsd,
      costSource: costUsd === null ? null : 'estimate',
    }) as unknown as UsageRecord

  it('用量：步骤记下跑过的轮次，按轮次从用量记录算 token 和花费；按会话取、带 sessionId 走本机', async () => {
    const { c, a, b, ch } = await setup()
    const { messageId } = await c.flowAction(ch, {
      type: 'create',
      title: '用量',
      steps: [
        { id: 's1', title: '画贴图', memberId: a, deps: [], kind: 'work' },
        { id: 's2', title: '写代码', memberId: b, deps: ['s1'], kind: 'work' },
      ],
    })
    await c.flowAction(ch, { type: 'start', messageId })
    await settle()
    const s1 = sessionOf(c, ch, 's1')
    usage.push(record(s1, 0.25))
    await endTurn(c, s1, '还没好')
    usage.push(record(s1, null, 50))
    c.toolDone(s1, { summary: '好了' })
    await endTurn(c, s1, '好了')
    expect(stepOf(c, ch, 's1').turns).toHaveLength(2)
    await c.refreshUsage()
    expect(stepOf(c, ch, 's1').usage).toMatchObject({
      input: 150,
      output: 20,
      costUsd: 0.25,
      costKnown: 1,
      records: 2,
      turns: 2,
      unrecorded: 0,
    })
    const q = calls.find(x => x.channel === 'engine:usageList')!.args[0] as Record<string, unknown>
    expect(q).toMatchObject({ sessionId: s1, filter: { session: s1 } })
    // 还没有记录的轮次算「没记录」；没变不重写
    const s2 = sessionOf(c, ch, 's2')
    await endTurn(c, s2, '写了一半')
    await c.refreshUsage()
    expect(stepOf(c, ch, 's2').usage).toMatchObject({ records: 0, turns: 1, unrecorded: 1 })
    const before = JSON.stringify(flowOf(c, ch))
    await c.refreshUsage()
    expect(JSON.stringify(flowOf(c, ch))).toBe(before)
    // 记录超出 30 天取不到了：留着原来的
    usage = []
    await c.refreshUsage()
    expect(stepOf(c, ch, 's1').usage).toMatchObject({ costUsd: 0.25, records: 2 })
  })

  it('花费上限：已知花费到了就停下；继续后从当时的花费再给一整份', async () => {
    const { c, a, b, ch } = await setup()
    const { messageId } = await c.flowAction(ch, {
      type: 'create',
      title: '花费',
      limits: { rounds: null, minutes: null, costUsd: 1 },
      steps: [
        { id: 's1', title: '画贴图', memberId: a, deps: [], kind: 'work' },
        { id: 's2', title: '写代码', memberId: b, deps: ['s1'], kind: 'work' },
      ],
    })
    await c.flowAction(ch, { type: 'start', messageId })
    await settle()
    const s1 = sessionOf(c, ch, 's1')
    usage.push(record(s1, 1.2))
    c.toolDone(s1, { summary: '好了' })
    await endTurn(c, s1, '好了')
    await c.refreshUsage()
    expect(flowOf(c, ch)).toMatchObject({ status: 'paused', paused: { reason: 'limit', limit: 'cost' } })
    await c.flowAction(ch, { type: 'resume', messageId })
    await settle()
    expect(flowOf(c, ch)).toMatchObject({ status: 'running', since: { cost: 1.2 } })
    await c.refreshUsage()
    expect(flowOf(c, ch).status).toBe('running')
  })

  it('定时运行：到点开一条流程，同一天不重复；上一次没结束就跳过；没开成记原因；没有能计价的成员不能存', async () => {
    const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime()
    now = at(25, 8)
    const { c, a, ch } = await setup()
    const schedule = {
      title: '早巡检',
      hour: 9,
      enabled: true,
      limits: { rounds: 5, minutes: 30, costUsd: 2 },
      steps: [{ id: 's1', title: '巡检', memberId: a, deps: [], kind: 'work' as const }],
    }
    await c.update(ch, { schedules: [schedule] })
    const saved = c.state().channels.find(x => x.id === ch)!.schedules![0]
    expect(saved).toMatchObject({ title: '早巡检', lastFlowMessageId: null })
    await c.checkAlerts()
    expect(c.messages(ch).messages.some(m => m.kind === 'message' && m.flow)).toBe(false)

    now = at(25, 9, 5)
    // 两次巡检重叠也只开一条
    await Promise.all([c.checkAlerts(), c.checkAlerts()])
    await settle()
    expect(flowOf(c, ch)).toMatchObject({ title: '早巡检', status: 'running', limits: schedule.limits })
    const first = c.state().channels.find(x => x.id === ch)!.schedules![0]
    expect(first.lastFlowMessageId).toBeTruthy()
    // 同一天不再开；改设置保留运行时的字段
    await c.update(ch, { schedules: [{ ...schedule, id: first.id, title: '早巡检2' }] })
    await c.checkAlerts()
    const flows = () => c.messages(ch).messages.filter(m => m.kind === 'message' && m.flow)
    expect(flows()).toHaveLength(1)
    expect(c.state().channels.find(x => x.id === ch)!.schedules![0].lastFlowMessageId).toBe(first.lastFlowMessageId)

    // 第二天上一次还在跑：跳过，记原因
    now = at(26, 10)
    await c.checkAlerts()
    expect(flows()).toHaveLength(1)
    expect(c.state().channels.find(x => x.id === ch)!.schedules![0].lastError).toContain('还没结束')

    // 第三天上一次结束了，但成员被移出频道：没开成，草稿丢掉，记原因
    const s1 = sessionOf(c, ch, 's1')
    c.toolDone(s1, { summary: '好了' })
    await endTurn(c, s1, '好了')
    await c.removeMember(ch, a)
    now = at(27, 9)
    await c.checkAlerts()
    await settle()
    expect(flows()).toHaveLength(1)
    expect(c.state().channels.find(x => x.id === ch)!.schedules![0].lastError).toBeTruthy()
    // 成员删掉了：步骤没改的旧定时照样能关
    await c.deleteMember(a)
    await c.update(ch, { schedules: [{ ...schedule, id: first.id, enabled: false }] })
    expect(c.state().channels.find(x => x.id === ch)!.schedules![0].enabled).toBe(false)

    // 只有 Codex（不报价格）的不能定时
    const x = await c.saveMember(null, { ...agent('跑腿'), engine: 'codex' })
    await expect(
      c.update(ch, { schedules: [{ ...schedule, steps: [{ ...schedule.steps[0], memberId: x }] }] }),
    ).rejects.toThrow('花费上限不会起作用')
    await expect(
      c.update(ch, { schedules: [{ ...schedule, limits: { ...schedule.limits, costUsd: null } }] as never }),
    ).rejects.toThrow('都要设')
  })
})
