// EngineHost 特征化测试：补现有 host / queue / session-lifecycle 测试没覆盖的路径。
// 期望值以当前行为为准（重构前的安全网），不是对行为的规定。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineInfo, HostEvent, ImageAttachment, SessionSettings, TurnUsage } from '@pixelsky/protocol'
import type { EngineAdapter, EngineSession, SessionContext } from '../src/adapter'
import { EngineHost } from '../src/host'
import { ENGINES } from '../src/registry'
import { makeTmp, removeTmp } from './helpers/tmp'

let root: string
let hosts: EngineHost[]
beforeEach(() => { root = makeTmp('host-characterization'); hosts = [] })
afterEach(async () => { await Promise.all(hosts.map(h => h.shutdown())); removeTmp(root) })
const until = async (fn: () => boolean) => { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 5)) } throw new Error('characterization timeout') }

class ScriptedSession implements EngineSession {
  active: string | null = null
  inputs: string[] = []
  constructor(readonly ctx: SessionContext) {}
  send(text: string, turnId: string, _id: string, _attachments?: ImageAttachment[]) { this.active = turnId; this.inputs.push(text) }
  finish(outcome: 'completed' | 'failed' | 'interrupted' = 'completed', usage?: TurnUsage) {
    const turnId = this.active!; this.active = null
    this.ctx.emit({ type: 'turn_completed', turnId, outcome, error: outcome === 'failed' ? 'failed' : null, ...(usage ? { usage } : {}) })
  }
  async interrupt() { if (this.active) this.finish('interrupted') }
  answer() {}
  async update(_patch: Partial<SessionSettings>) {}
  async close() { if (this.active) this.finish('interrupted') }
  async stopTask() {}
  async taskOutput() { return { output: '', truncated: false } }
}
class ScriptedAdapter implements EngineAdapter {
  sessions: ScriptedSession[] = []
  async info(): Promise<EngineInfo> { return { ...ENGINES.claude, status: 'ready', version: 'fake', path: 'fake', message: null } }
  createSession(ctx: SessionContext) { const s = new ScriptedSession(ctx); this.sessions.push(s); return s }
}
function setup() {
  const adapter = new ScriptedAdapter(), events: HostEvent[] = [], dataDir = join(root, 'data')
  const host = new EngineHost({ dataDir, adapters: { claude: adapter }, emit: e => events.push(e) })
  hosts.push(host)
  const project = host.addProject(root), record = host.createSession({ projectId: project.id, model: 'alpha', effort: 'low' })
  const send = (id: string, text = id) => host.send(record.id, { text, clientMessageId: id })
  const queueIds = () => host.open(record.id).queue.map(q => q.id)
  const sessionDir = join(dataDir, 'sessions', record.id)
  const diskQueue = () => (JSON.parse(readFileSync(join(sessionDir, 'queue.json'), 'utf8')) as { items: Array<{ id: string }>; paused: boolean }).items.map(i => i.id)
  return { host, adapter, events, project, record, send, queueIds, sessionDir, diskQueue, dataDir }
}
/** 发出 a（运行中），再排队 b c d */
async function running(s: ReturnType<typeof setup>) {
  await s.send('a'); await until(() => !!s.adapter.sessions[0]?.active)
  await s.send('b'); await s.send('c'); await s.send('d')
}

describe('队列：暂停 / 继续', () => {
  it('停止后暂停；继续队列按原顺序逐条发送，并清掉暂停标记', async () => {
    const s = await (async () => { const v = setup(); await running(v); return v })()
    await s.host.interrupt(s.record.id)
    expect(s.host.open(s.record.id).queuePaused).toBe(true)
    expect(s.queueIds()).toEqual(['b', 'c', 'd'])
    expect(s.adapter.sessions[0].inputs).toEqual(['a'])
    s.host.resumeQueue(s.record.id)
    expect(s.host.open(s.record.id).queuePaused).toBe(false)
    await until(() => s.adapter.sessions[0].inputs.length === 2)
    expect(s.adapter.sessions[0].inputs[1]).toBe('b')
    s.adapter.sessions[0].finish(); await until(() => s.adapter.sessions[0].inputs.length === 3)
    expect(s.adapter.sessions[0].inputs[2]).toBe('c')
  })

  it('暂停状态写入 queue.json，会话摘要带暂停的队列概况', async () => {
    const s = setup(); await running(s)
    await s.host.interrupt(s.record.id)
    const raw = JSON.parse(readFileSync(join(s.sessionDir, 'queue.json'), 'utf8')) as { version: number; paused: boolean; items: unknown[] }
    expect(raw).toMatchObject({ version: 1, paused: true })
    expect(raw.items).toHaveLength(3)
    expect(s.host.sessions().find(x => x.record.id === s.record.id)?.queue).toEqual({ queued: 3, failed: 0, paused: true })
  })

  it('没有暂停时继续队列不改变排队，也不重复发送正在运行的消息', async () => {
    const s = setup(); await running(s)
    s.host.resumeQueue(s.record.id)
    await new Promise(r => setTimeout(r, 30))
    expect(s.queueIds()).toEqual(['a', 'b', 'c', 'd'])
    expect(s.adapter.sessions[0].inputs).toEqual(['a'])
  })
})

describe('队列：调序 / 撤回', () => {
  it('调序的目标位置超出范围时夹到两端，并同步写入磁盘', async () => {
    const s = setup(); await running(s)
    s.host.moveQueued(s.record.id, 'd', -5)
    // 位置 0 是整个队列的首位（包括正在运行的项）
    expect(s.queueIds()).toEqual(['d', 'a', 'b', 'c'])
    s.host.moveQueued(s.record.id, 'd', 99)
    expect(s.queueIds()).toEqual(['a', 'b', 'c', 'd'])
    s.host.moveQueued(s.record.id, 'b', 2.9)
    expect(s.queueIds()).toEqual(['a', 'c', 'b', 'd'])
    expect(s.diskQueue()).toEqual(['a', 'c', 'b', 'd'])
  })

  it('只有排队中的项可以调序；正在运行的项和不存在的项被拒绝', async () => {
    const s = setup(); await running(s)
    expect(() => s.host.moveQueued(s.record.id, 'a', 2)).toThrow('只有排队中的消息可以调序')
    expect(() => s.host.moveQueued(s.record.id, 'nope', 0)).toThrow('只有排队中的消息可以调序')
    expect(s.queueIds()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('撤回不存在的消息报错；撤回暂停队列里的项不会恢复队列', async () => {
    const s = setup(); await running(s)
    expect(() => s.host.cancelQueued(s.record.id, 'nope')).toThrow('已开始处理或已经撤回')
    await s.host.interrupt(s.record.id)
    expect(s.host.cancelQueued(s.record.id, 'c')).toBe('c')
    expect(s.queueIds()).toEqual(['b', 'd'])
    expect(s.host.open(s.record.id).queuePaused).toBe(true)
    expect(s.diskQueue()).toEqual(['b', 'd'])
  })

  it('撤回最后一条排队项后队列文件仍在，摘要只剩正在运行的那条', async () => {
    const s = setup()
    await s.send('a'); await until(() => !!s.adapter.sessions[0]?.active)
    await s.send('b')
    s.host.cancelQueued(s.record.id, 'b')
    expect(s.host.sessions().find(x => x.record.id === s.record.id)?.queue).toEqual({ queued: 1, failed: 0, paused: false })
    expect(s.diskQueue()).toEqual(['a'])
  })
})

describe('回退到某条用户消息', () => {
  async function twoTurns() {
    const s = setup()
    await s.send('m1', '第一句'); await until(() => !!s.adapter.sessions[0]?.active); s.adapter.sessions[0].finish()
    await until(() => s.host.open(s.record.id).state === 'idle')
    await s.send('m2', '第二句'); await until(() => s.adapter.sessions[0].inputs.length === 2); s.adapter.sessions[0].finish()
    await until(() => s.host.open(s.record.id).state === 'idle')
    return s
  }
  const userIds = (s: ReturnType<typeof setup>) => s.host.open(s.record.id).items.flatMap(i => i.kind === 'user' ? [i.id] : [])
  const diskUsers = (s: ReturnType<typeof setup>) => readFileSync(join(s.sessionDir, 'items.jsonl'), 'utf8').split('\n').filter(Boolean)
    .map(l => JSON.parse(l) as { kind: string; id: string }).filter(i => i.kind === 'user').map(i => i.id)

  it('回退到第二条：返回原文，内存与磁盘上的对话都只剩第一轮', async () => {
    const s = await twoTurns()
    expect(userIds(s)).toEqual(['m1', 'm2'])
    expect(diskUsers(s)).toEqual(['m1', 'm2'])
    await expect(s.host.rewind(s.record.id, 'm2')).resolves.toEqual({ text: '第二句' })
    expect(userIds(s)).toEqual(['m1'])
    expect(diskUsers(s)).toEqual(['m1'])
  })

  it('回退后重新打开，对话保持截断；没有引擎会话 id 时不加提示', async () => {
    const s = await twoTurns()
    await s.host.rewind(s.record.id, 'm1')
    expect(s.host.open(s.record.id).items).toEqual([])
    expect(s.host.open(s.record.id).items.some(i => i.kind === 'notice')).toBe(false)
    const again = new EngineHost({ dataDir: s.dataDir, adapters: { claude: s.adapter }, emit() {} }); hosts.push(again)
    expect(again.open(s.record.id).items).toEqual([])
  })

  it('不存在的消息不能回退', async () => {
    const s = await twoTurns()
    await expect(s.host.rewind(s.record.id, 'nope')).rejects.toThrow('自己发送')
    expect(userIds(s)).toEqual(['m1', 'm2'])
  })

  it('运行中拒绝回退', async () => {
    const s = await twoTurns()
    await s.send('m3', '第三句'); await until(() => s.adapter.sessions[0].inputs.length === 3)
    await expect(s.host.rewind(s.record.id, 'm1')).rejects.toThrow('停止')
    expect(userIds(s)).toEqual(['m1', 'm2', 'm3'])
  })
})

describe('归档与删除', () => {
  it('归档保留磁盘上的对话与队列；取消归档后内容还在', async () => {
    const s = setup(); await running(s)
    await s.host.archiveSession(s.record.id, true, true)
    expect(existsSync(join(s.sessionDir, 'items.jsonl'))).toBe(true)
    expect(existsSync(join(s.sessionDir, 'queue.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(s.sessionDir, 'record.json'), 'utf8')).archivedAt).toEqual(expect.any(Number))
    await s.host.archiveSession(s.record.id, false)
    expect(s.host.record(s.record.id)?.archivedAt).toBeNull()
    expect(s.host.open(s.record.id).items.some(i => i.kind === 'user' && i.id === 'a')).toBe(true)
  })

  it('重复归档或取消归档什么都不做', async () => {
    const s = setup()
    await s.host.archiveSession(s.record.id, false)
    expect(s.host.record(s.record.id)?.archivedAt).toBeNull()
    await s.host.archiveSession(s.record.id, true)
    const at = s.host.record(s.record.id)?.archivedAt
    await s.host.archiveSession(s.record.id, true)
    expect(s.host.record(s.record.id)?.archivedAt).toBe(at)
  })

  it('删除后会话列表、磁盘目录都没有；再打开报错；用量记录保留', async () => {
    const s = setup()
    await s.send('a'); await until(() => !!s.adapter.sessions[0]?.active)
    s.adapter.sessions[0].finish('completed', { durationMs: 10, models: { alpha: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4, costUsd: 0.1 } } })
    await until(() => s.host.open(s.record.id).items.some(i => i.kind === 'turn_stats'))
    await s.host.deleteSession(s.record.id)
    expect(s.host.sessions().map(x => x.record.id)).not.toContain(s.record.id)
    expect(existsSync(s.sessionDir)).toBe(false)
    expect(() => s.host.open(s.record.id)).toThrow('会话不存在')
    expect(s.host.projects()).toHaveLength(1)
    expect(s.host.usageList({ range: 'today', now: Date.now() + 10, filter: {}, offset: 0, limit: 10 }).total).toBe(1)
  })

  it('删除不存在的会话 id 不报错，非法 id 报错', async () => {
    const s = setup()
    await expect(s.host.deleteSession('00000000-0000-4000-8000-000000000000')).resolves.toBeUndefined()
    await expect(s.host.deleteSession('../escape')).rejects.toThrow('不合法')
  })
})

describe('用量记录写入', () => {
  const thisMonthFile = (dataDir: string) => readdirSync(join(dataDir, 'usage')).filter(n => /^usage-\d{4}-\d{2}\.jsonl$/.test(n))

  it('一轮多个模型各写一条；失败轮次也记录；project / route / 默认费用来源按当前规则', async () => {
    const s = setup()
    await s.send('a'); await until(() => !!s.adapter.sessions[0]?.active)
    const turnId = s.adapter.sessions[0].active!
    s.adapter.sessions[0].finish('failed', { durationMs: 40, models: {
      alpha: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4, costUsd: 0.5, requests: 2 },
      beta: { input: 10, cacheRead: 0, cacheWrite: 0, output: 1, costUsd: null },
    } })
    await until(() => s.host.open(s.record.id).items.some(i => i.kind === 'turn_stats'))
    const files = thisMonthFile(s.dataDir)
    expect(files).toHaveLength(1)
    const rows = readFileSync(join(s.dataDir, 'usage', files[0]), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)
    expect(rows.map(r => r.id)).toEqual([`${s.record.id}:${turnId}:alpha`, `${s.record.id}:${turnId}:beta`])
    expect(rows[0]).toMatchObject({ v: 1, sessionId: s.record.id, turnId, project: s.project.name, engine: 'claude', route: 'cli',
      costSource: 'estimate', outcome: 'failed', durationMs: 40, input: 1, cacheRead: 2, cacheWrite: 3, output: 4, costUsd: 0.5, requests: 2 })
    expect(rows[1]).toMatchObject({ model: 'beta', costUsd: null, outcome: 'failed' })
    expect(s.events.filter(e => e.kind === 'usage_recorded')).toHaveLength(1)
    const stats = s.host.open(s.record.id).items.find(i => i.kind === 'turn_stats')
    expect(stats).toMatchObject({ id: `stats-${turnId}`, outcome: 'failed' })
  })

  it('没有用量的轮次不写记录、不加统计行、不广播', async () => {
    const s = setup()
    await s.send('a'); await until(() => !!s.adapter.sessions[0]?.active)
    s.adapter.sessions[0].finish()
    await until(() => s.host.open(s.record.id).state === 'idle')
    expect(s.host.open(s.record.id).items.some(i => i.kind === 'turn_stats')).toBe(false)
    expect(thisMonthFile(s.dataDir)).toEqual([])
    expect(s.events.some(e => e.kind === 'usage_recorded')).toBe(false)
  })

  it('清空用量删除文件并广播；之后的新轮次照常记录', async () => {
    const s = setup()
    const usage: TurnUsage = { durationMs: 5, models: { alpha: { input: 1, cacheRead: 0, cacheWrite: 0, output: 1, costUsd: 0.01 } } }
    await s.send('a'); await until(() => !!s.adapter.sessions[0]?.active)
    s.adapter.sessions[0].finish('completed', usage); await until(() => thisMonthFile(s.dataDir).length === 1)
    s.host.usageClear()
    expect(thisMonthFile(s.dataDir)).toEqual([])
    expect(s.events.filter(e => e.kind === 'usage_recorded')).toHaveLength(2)
    await s.send('b'); await until(() => s.adapter.sessions[0].inputs.length === 2)
    s.adapter.sessions[0].finish('completed', usage); await until(() => thisMonthFile(s.dataDir).length === 1)
    expect(s.host.usageList({ range: 'today', now: Date.now() + 10, filter: {}, offset: 0, limit: 10 }).total).toBe(1)
  })
})
