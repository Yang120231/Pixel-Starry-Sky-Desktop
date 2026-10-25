// 限流 / 额度用完后到点自动继续（docs/ui/rate-limit-resume.md）
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineInfo, Item, SessionSettings } from '@pixelsky/protocol'
import type { EngineAdapter, EngineSession, SessionContext } from '../src/adapter'
import { EngineHost, type EngineHostOptions } from '../src/host'
import { ENGINES } from '../src/registry'
import { LIMIT_BACKOFF, LIMIT_SLACK_MS, FIREWALL_BLOCKED, limitDelay, limitKind } from '../src/retry'

let root: string
let hosts: EngineHost[]
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pixelsky-limit-'))
  hosts = []
})
afterEach(async () => {
  await Promise.all(hosts.map(h => h.shutdown()))
  rmSync(root, { recursive: true, force: true })
})
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 300; i++) {
    if (fn()) return
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error('limit timeout')
}

const RATE = 'Claude 请求太频繁，已触发限额（429）'

class FakeSession implements EngineSession {
  active: string | null = null
  inputs: Array<{ text: string; id: string }> = []
  private outputs = 0
  constructor(readonly ctx: SessionContext) {}
  send(text: string, turnId: string, id: string) {
    this.active = turnId
    this.inputs.push({ text, id })
    this.ctx.emit({ type: 'input_ack', id, state: 'consumed', mode: 'normal' })
  }
  output() {
    this.ctx.emit({
      type: 'item_started',
      item: { kind: 'assistant', id: `out-${++this.outputs}`, text: '', status: 'running' },
    })
  }
  /** 订阅额度用完：报错带 usageLimitExceeded，宿主据此认作额度（不是只有一条 429） */
  quota() {
    this.ctx.emit({
      type: 'item_completed',
      item: {
        kind: 'notice',
        id: `n-${this.inputs.length}`,
        level: 'error',
        text: 'Claude 订阅的额度用完了',
        error: { kind: 'balance', code: 'usageLimitExceeded' },
      },
    })
    this.finish('failed', 'Claude 订阅的额度用完了')
  }
  finish(outcome: 'completed' | 'failed' | 'interrupted' = 'completed', error: string | null = null) {
    const turnId = this.active!
    this.active = null
    this.ctx.emit({ type: 'turn_completed', turnId, outcome, error })
  }
  async interrupt() {
    if (this.active) this.finish('interrupted')
  }
  answer() {}
  async update(_patch: Partial<SessionSettings>) {}
  async close() {
    if (this.active) this.finish('interrupted')
  }
}
class FakeAdapter implements EngineAdapter {
  sessions: FakeSession[] = []
  async info(): Promise<EngineInfo> {
    return { ...ENGINES.claude, status: 'ready', version: 'fake', path: 'fake', message: null }
  }
  createSession(ctx: SessionContext) {
    const s = new FakeSession(ctx)
    this.sessions.push(s)
    return s
  }
}
function setup(opts: Partial<EngineHostOptions> = {}, dir = join(root, 'data')) {
  const adapter = new FakeAdapter()
  const host = new EngineHost({
    dataDir: dir,
    adapters: { claude: adapter },
    emit: () => {},
    continueText: () => 'Continue',
    limitDelays: [0, 0, 0],
    ...opts,
  })
  hosts.push(host)
  const p = host.addProject(root)
  const record = host.createSession({ projectId: p.id, model: 'alpha', effort: 'low' })
  const send = (id: string, text = id) => host.send(record.id, { text, clientMessageId: id })
  const snap = () => host.open(record.id)
  const users = () => snap().items.filter((i): i is Extract<Item, { kind: 'user' }> => i.kind === 'user')
  return { host, adapter, record, send, snap, users, session: () => adapter.sessions[0] }
}

describe('limitKind / limitDelay', () => {
  it('认 429 和额度用完；余额不足、被防护拦截、普通错误不算', () => {
    expect(limitKind(RATE)).toBe('rate')
    expect(limitKind('API Error: 429 Too Many Requests')).toBe('rate')
    expect(limitKind('Claude 订阅的额度用完了', true)).toBe('quota')
    expect(limitKind('余额不足（429）')).toBeNull()
    expect(limitKind(FIREWALL_BLOCKED)).toBeNull()
    expect(limitKind('登录已失效')).toBeNull()
    expect(limitKind(null)).toBeNull()
  })

  it('有还没到的恢复时间就等到它之后，否则按失败次数退避 1、5、15 分钟', () => {
    expect(limitDelay(0, 10_000, 4_000)).toBe(6_000 + LIMIT_SLACK_MS)
    expect(limitDelay(0, null, 0)).toBe(LIMIT_BACKOFF[0])
    expect(limitDelay(1, 1_000, 5_000)).toBe(LIMIT_BACKOFF[1])
    expect(limitDelay(2, null, 0)).toBe(LIMIT_BACKOFF[2])
    expect(limitDelay(9, null, 0)).toBe(LIMIT_BACKOFF[2])
  })
})

describe('限流后到点自动继续', () => {
  it('429：先不标失败，到点发带 reconnect 的「继续」；连续 3 次仍被限流就停止，手动重试再发', async () => {
    const { host, record, send, snap, users, session } = setup()
    await send('a', '补测试')
    await until(() => !!session()?.active)
    session().finish('failed', RATE)
    await until(() => session().inputs.length === 2)
    expect(session().inputs.map(i => i.text.split('\n').at(-1))).toEqual(['补测试', 'Continue'])
    // 自动发的「继续」带 reconnect 标记（不算新一轮）和等待时间
    expect(users().at(-1)).toMatchObject({ text: 'Continue', reconnect: 1, limit: { since: expect.any(Number) } })
    session().finish('failed', RATE)
    await until(() => session().inputs.length === 3)
    session().finish('failed', RATE)
    await until(() => session().inputs.length === 4)
    session().finish('failed', RATE)
    await until(() => snap().queuePaused)
    const item = snap().queue[0]
    expect(item).toMatchObject({
      id: 'a',
      status: 'queued',
      limit: { kind: 'rate', tries: [expect.any(Number), expect.any(Number), expect.any(Number)] },
    })
    expect(item.reconnect).toMatchObject({ limited: true })
    expect(session().inputs).toHaveLength(4)
    await new Promise(r => setTimeout(r, 50))
    expect(session().inputs).toHaveLength(4)
    // 手动重试：现有的 runQueuedNow，成功就清掉
    await host.runQueuedNow(record.id, 'a')
    await until(() => session().inputs.length === 5)
    session().finish()
    await until(() => snap().state === 'idle')
    expect(snap().queue).toEqual([])
  })

  it('这一轮有输出（成功推进）就从头算次数', async () => {
    const { snap, send, session } = setup({ limitDelays: [0, 0, 0] })
    await send('a')
    await until(() => !!session()?.active)
    session().finish('failed', RATE)
    await until(() => session().inputs.length === 2)
    session().finish('failed', RATE)
    await until(() => session().inputs.length === 3)
    expect(snap().queue[0].limit?.tries).toHaveLength(1)
    session().output()
    session().finish('failed', RATE)
    await until(() => session().inputs.length === 4)
    expect(snap().queue[0].limit?.tries).toEqual([])
  })

  it('额度用完（usageLimitExceeded）也走等待；没有恢复时间时按退避', async () => {
    const { snap, send, session } = setup({ limitDelays: [60_000] })
    await send('a')
    await until(() => !!session()?.active)
    session().quota()
    await until(() => snap().queue[0]?.limit !== undefined)
    const q = snap().queue[0]
    expect(q.limit).toMatchObject({ kind: 'quota', resetsAt: null, tries: [] })
    expect(q.reconnect!.at - q.reconnect!.since).toBe(60_000)
    expect(snap().queuePaused).toBe(false)
    expect(session().inputs).toHaveLength(1)
  })

  it('等待中用户自己发消息：当取消，新消息直接发出，不留发送失败', async () => {
    const { host, record, snap, send, users, session } = setup({ limitDelays: [60_000] })
    await send('a')
    await until(() => !!session()?.active)
    session().finish('failed', RATE)
    await until(() => snap().queue[0]?.limit !== undefined)
    await send('b')
    await until(() => session().inputs.length === 2)
    expect(session().inputs[1].text).toBe('b')
    expect(snap().queue.map(q => q.id)).toEqual(['b'])
    // 引擎收到过原消息，不标「未送达」
    expect(users()[0].dismissed).toBeUndefined()
    session().finish()
    await until(() => snap().state === 'idle')
    expect(host.open(record.id).queue).toEqual([])
  })

  it('「取消等待」（interrupt）收起卡片，不留失败项', async () => {
    const { host, record, snap, send, session } = setup({ limitDelays: [60_000] })
    await send('a')
    await until(() => !!session()?.active)
    session().finish('failed', RATE)
    await until(() => snap().queue[0]?.limit !== undefined)
    await host.interrupt(record.id)
    expect(snap().queue).toEqual([])
    await new Promise(r => setTimeout(r, 30))
    expect(session().inputs).toHaveLength(1)
  })

  it('取消勾选（pauseReconnect）后到点不发，勾回去（resumeQueue）才发', async () => {
    const { host, record, snap, send, session } = setup({ limitDelays: [80] })
    await send('a')
    await until(() => !!session()?.active)
    session().finish('failed', RATE)
    await until(() => snap().queue[0]?.limit !== undefined)
    host.pauseReconnect(record.id)
    expect(snap().queuePaused).toBe(true)
    await new Promise(r => setTimeout(r, 200))
    expect(session().inputs).toHaveLength(1)
    host.resumeQueue(record.id)
    await until(() => session().inputs.length === 2)
    session().finish()
    await until(() => snap().state === 'idle')
  })

  it('没有在等待的时候 pauseReconnect 报错', async () => {
    const { host, record } = setup()
    expect(() => host.pauseReconnect(record.id)).toThrow('没有在等待恢复的消息')
  })

  it('斜杠命令不等待，照常失败', async () => {
    const { snap, send, session } = setup()
    await send('a', '/compact')
    await until(() => !!session()?.active)
    session().finish('failed', RATE)
    await until(() => snap().queue[0]?.status === 'failed')
    expect(snap().queue[0].limit).toBeUndefined()
  })

  it('队列摘要给出下一次继续的时间点，暂停后没有', async () => {
    const { host, record, snap, send, session } = setup({ limitDelays: [60_000] })
    await send('a')
    await until(() => !!session()?.active)
    session().finish('failed', RATE)
    await until(() => snap().queue[0]?.limit !== undefined)
    const at = snap().queue[0].reconnect!.at
    expect(host.sessions().find(s => s.record.id === record.id)?.queue).toMatchObject({ limitAt: at })
    host.pauseReconnect(record.id)
    expect(host.sessions().find(s => s.record.id === record.id)?.queue?.limitAt).toBeUndefined()
  })

  it('应用关掉再开：等待项和恢复时间还在、队列暂停，不自己补发', async () => {
    const dir = join(root, 'data')
    const first = setup({ limitDelays: [60_000] }, dir)
    await first.send('a')
    await until(() => !!first.session()?.active)
    first.session().finish('failed', RATE)
    await until(() => first.snap().queue[0]?.limit !== undefined)
    const at = first.snap().queue[0].reconnect!.at
    await first.host.shutdown()
    const adapter = new FakeAdapter()
    const host = new EngineHost({ dataDir: dir, adapters: { claude: adapter }, emit: () => {}, limitDelays: [0] })
    hosts.push(host)
    const reopened = host.open(first.record.id)
    expect(reopened.queuePaused).toBe(true)
    expect(reopened.queue[0]).toMatchObject({
      id: 'a',
      status: 'queued',
      limit: { kind: 'rate' },
      reconnect: { limited: true, at },
    })
    await new Promise(r => setTimeout(r, 50))
    expect(adapter.sessions).toHaveLength(0)
  })
})
