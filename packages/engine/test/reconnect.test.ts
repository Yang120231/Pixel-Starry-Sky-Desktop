import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineInfo, Item, SessionSettings } from '@pixelsky/protocol'
import type { EngineAdapter, EngineSession, SessionContext } from '../src/adapter'
import { EngineHost, type EngineHostOptions } from '../src/host'
import { ENGINES } from '../src/registry'
import { isConnectionError, reconnectDelay, reconnectLimit } from '../src/retry'

let root: string
let hosts: EngineHost[]
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pixelsky-reconnect-'))
  hosts = []
})
afterEach(async () => {
  await Promise.all(hosts.map(h => h.shutdown()))
  rmSync(root, { recursive: true, force: true })
})
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error('reconnect timeout')
}

const DROPPED = 'stream disconnected before completion: error sending request'

class ScriptedSession implements EngineSession {
  active: string | null = null
  inputs: Array<{ text: string; id: string }> = []
  constructor(readonly ctx: SessionContext) {}
  send(text: string, turnId: string, id: string) {
    this.active = turnId
    this.inputs.push({ text, id })
  }
  finish(outcome: 'completed' | 'failed' | 'interrupted' = 'completed', error: string | null = null) {
    const turnId = this.active!
    this.active = null
    this.ctx.emit({ type: 'turn_completed', turnId, outcome, error })
  }
  drop() {
    this.finish('failed', DROPPED)
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
class ScriptedAdapter implements EngineAdapter {
  sessions: ScriptedSession[] = []
  async info(): Promise<EngineInfo> {
    return { ...ENGINES.claude, status: 'ready', version: 'fake', path: 'fake', message: null }
  }
  createSession(ctx: SessionContext) {
    const s = new ScriptedSession(ctx)
    this.sessions.push(s)
    return s
  }
}
function setup(opts: Partial<EngineHostOptions> = {}) {
  const adapter = new ScriptedAdapter()
  const host = new EngineHost({
    dataDir: join(root, 'data'),
    adapters: { claude: adapter },
    emit: () => {},
    reconnectDelays: [0, 0, 0, 0, 0],
    ...opts,
  })
  hosts.push(host)
  const p = host.addProject(root),
    record = host.createSession({ projectId: p.id, model: 'alpha', effort: 'low' })
  const send = (id: string, text = id) => host.send(record.id, { text, clientMessageId: id })
  const users = () =>
    host
      .open(record.id)
      .items.filter((i): i is Extract<Item, { kind: 'user' }> => i.kind === 'user')
      .map(i => ({ text: i.text, reconnect: i.reconnect, dismissed: i.dismissed }))
  return { host, adapter, record, send, users, session: () => adapter.sessions[0] }
}

describe('断线自动重连', () => {
  it('连接中断：不标失败也不暂停，自动发一句「继续」接着做，接上后这条算交付', async () => {
    const { host, record, send, users, session } = setup({ continueText: () => 'Continue' })
    await send('a', '把单测补上')
    await until(() => !!session()?.active)
    session().drop()
    await until(() => session().inputs.length === 2)
    expect(session().inputs.map(i => i.text)).toEqual(['把单测补上', 'Continue'])
    expect(host.open(record.id).queuePaused).toBe(false)
    expect(host.open(record.id).queue[0]).toMatchObject({ id: 'a', status: 'running', reconnect: { attempt: 1 } })
    expect(users()).toEqual([
      { text: '把单测补上', reconnect: undefined, dismissed: undefined },
      { text: 'Continue', reconnect: 1, dismissed: undefined },
    ])
    session().finish()
    await until(() => host.open(record.id).state === 'idle')
    expect(host.open(record.id).queue).toEqual([])
  })

  it('次数用完才算发送失败，记下自动重连了几次；之后可以关掉，对话里那条标「未送达」', async () => {
    const { host, record, send, users, session } = setup()
    host.setRetrySettings(2)
    await send('a')
    for (let n = 1; n <= 3; n++) {
      await until(() => !!session()?.active && session().inputs.length === n)
      session().drop()
    }
    await until(() => host.open(record.id).queue[0]?.status === 'failed')
    expect(host.open(record.id).queue[0]).toMatchObject({ error: DROPPED, reconnected: 2, reconnect: undefined })
    expect(host.open(record.id).queuePaused).toBe(true)
    // 失败的一轮不推进引擎的游标，后面的「继续」前面会带交接材料（handoff.ts）
    expect(session().inputs.map(i => i.text.split('\n').at(-1))).toEqual(['a', '继续', '继续'])
    host.dismissQueued(record.id, 'a')
    expect(host.open(record.id)).toMatchObject({ queue: [], queuePaused: false })
    expect(users()[0]).toEqual({ text: 'a', reconnect: undefined, dismissed: true })
  })

  it('不是连接问题的失败照常失败，不自动重连', async () => {
    const { host, record, send, session } = setup()
    await send('a')
    await until(() => !!session()?.active)
    session().finish('failed', '登录已失效，请重新登录')
    await until(() => host.open(record.id).queue[0]?.status === 'failed')
    expect(session().inputs).toHaveLength(1)
    expect(host.open(record.id).queue[0].reconnected).toBeUndefined()
  })

  it('重连次数设成 0 就是关闭自动重连', async () => {
    const { host, record, send, session } = setup()
    host.setRetrySettings(0)
    await send('a')
    await until(() => !!session()?.active)
    session().drop()
    await until(() => host.open(record.id).queue[0]?.status === 'failed')
    expect(session().inputs).toHaveLength(1)
  })

  it('等重连时：后面的消息也等着；立即重连不等倒计时；停止就算发送失败', async () => {
    const { host, record, send, session } = setup({ reconnectDelays: [60_000, 60_000] })
    await send('a')
    await until(() => !!session()?.active)
    session().drop()
    await until(() => host.open(record.id).queue[0]?.reconnect?.attempt === 1)
    await send('b')
    await new Promise(r => setTimeout(r, 30))
    expect(session().inputs).toHaveLength(1)
    await host.runQueuedNow(record.id, 'a')
    await until(() => session().inputs.length === 2)
    expect(session().inputs[1].text).toBe('继续')
    session().drop()
    await until(() => host.open(record.id).queue[0]?.reconnect?.attempt === 2)
    await host.interrupt(record.id)
    expect(host.open(record.id).queue.map(q => [q.id, q.status, q.reconnected ?? null])).toEqual([
      ['a', 'failed', 1],
      ['b', 'queued', null],
    ])
    expect(host.open(record.id).queuePaused).toBe(true)
    expect(session().inputs).toHaveLength(2)
  })

  it('消息还没发出去就连不上：到时原样重发同一条，不多出一条消息', async () => {
    let fail = 1
    const { host, record, send, users, session } = setup({
      validateInput: async () => {
        if (fail-- > 0) throw new Error('fetch failed')
      },
    })
    await send('a', '你好')
    await until(() => session()?.inputs.length === 1)
    expect(session().inputs[0]).toMatchObject({ text: '你好', id: 'a' })
    expect(users()).toEqual([{ text: '你好', reconnect: undefined, dismissed: undefined }])
    expect(() => host.dismissQueued(record.id, 'a')).toThrow()
  })

  it('还没进对话的失败消息不能关掉，只能重试或撤回', async () => {
    const { host, record, send } = setup({
      validateInput: async () => {
        throw new Error('账号已切换')
      },
    })
    await send('a')
    await until(() => host.open(record.id).queue[0]?.status === 'failed')
    expect(() => host.dismissQueued(record.id, 'a')).toThrow('这条消息还没发出去，请重试或撤回')
  })

  it('有发送失败的消息时直接说新的：失败那条自动关掉', async () => {
    const { host, record, send, users, session } = setup()
    await send('a')
    await until(() => !!session()?.active)
    session().finish('failed', '请求无效')
    await until(() => host.open(record.id).state === 'idle')
    await send('b', '继续')
    await until(() => session().inputs.length === 2)
    expect(host.open(record.id).queue.map(q => q.id)).toEqual(['b'])
    expect(users().map(u => [u.text, !!u.dismissed])).toEqual([
      ['a', true],
      ['继续', false],
    ])
  })
})

describe('retry.ts 自动重连规则', () => {
  it('只认连接类错误', () => {
    for (const text of [
      DROPPED,
      'ECONNRESET',
      'socket hang up',
      'API Error: 503 Service Unavailable',
      'Overloaded',
      '连不上模型服务',
      'Codex 意外退出（代码 1）',
    ])
      expect(isConnectionError(text), text).toBe(true)
    for (const text of [
      null,
      '',
      '登录已失效，请重新登录',
      '余额不足',
      'API Error: 401 Unauthorized',
      '429 rate limit exceeded',
      '找不到所选模型',
      'Prompt is too long',
    ])
      expect(isConnectionError(text), String(text)).toBe(false)
  })

  it('等待时间 1 秒起翻倍、封顶 30 秒、±20% 抖动；次数跟随请求重试设置', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(n => reconnectDelay(n, () => 0.5))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ])
    expect(reconnectDelay(1, () => 0)).toBe(800)
    expect(reconnectDelay(1, () => 1)).toBe(1200)
    expect(reconnectLimit(null)).toBe(5)
    expect(reconnectLimit(3)).toBe(3)
  })
})
