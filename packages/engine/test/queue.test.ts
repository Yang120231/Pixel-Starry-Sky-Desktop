import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineEvent, EngineInfo, ImageAttachment, SessionRecord, SessionSettings } from '@pixelsky/protocol'
import type { EngineAdapter, EngineSession, SessionContext } from '../src/adapter'
import { EngineHost, type EngineHostOptions } from '../src/host'
import { ENGINES } from '../src/registry'

let root: string
let hosts: EngineHost[]
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pixelsky-queue-'))
  hosts = []
})
afterEach(async () => {
  await Promise.all(hosts.map(h => h.shutdown()))
  rmSync(root, { recursive: true, force: true })
})
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) return
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error('queue timeout')
}

class ScriptedSession implements EngineSession {
  active: string | null = null
  inputs: Array<{ text: string; id: string; settings: SessionRecord; attachments?: ImageAttachment[] }> = []
  constructor(readonly ctx: SessionContext) {}
  send(text: string, turnId: string, id: string, attachments?: ImageAttachment[]) {
    this.active = turnId
    this.inputs.push({ text, id, settings: { ...this.ctx.record() }, attachments })
  }
  finish(outcome: 'completed' | 'failed' | 'interrupted' = 'completed') {
    const turnId = this.active!
    this.active = null
    this.ctx.emit({ type: 'turn_completed', turnId, outcome, error: outcome === 'failed' ? 'failed' : null })
  }
  async interrupt() {
    if (this.active) this.finish('interrupted')
  }
  answer() {}
  async update(_patch: Partial<SessionSettings>) {}
  async close() {
    if (this.active) this.finish('interrupted')
  }
  async stopTask() {}
  async taskOutput() {
    return { output: '', truncated: false }
  }
  async steer(_text: string, id: string) {
    this.ctx.emit({ type: 'input_ack', id, state: 'consumed' })
  }
}
class ScriptedAdapter implements EngineAdapter {
  sessions: ScriptedSession[] = []
  beforeInfo: (() => Promise<void>) | null = null
  async info(): Promise<EngineInfo> {
    await this.beforeInfo?.()
    return { ...ENGINES.claude, status: 'ready', version: 'fake', path: 'fake', message: null }
  }
  createSession(ctx: SessionContext) {
    const s = new ScriptedSession(ctx)
    this.sessions.push(s)
    return s
  }
}
function setup(opts: Partial<EngineHostOptions> = {}) {
  const adapter = new ScriptedAdapter(),
    events: EngineEvent[] = []
  const host = new EngineHost({
    dataDir: join(root, 'data'),
    adapters: { claude: adapter },
    emit: e => {
      if (e.kind === 'session') events.push(e.event)
    },
    ...opts,
  })
  hosts.push(host)
  const p = host.addProject(root),
    record = host.createSession({ projectId: p.id, model: 'alpha', effort: 'low' })
  const send = (id: string, text = id) => host.send(record.id, { text, clientMessageId: id })
  return { host, adapter, record, send, events }
}

describe('消息队列：调度与恢复', () => {
  it('纯图片入队、失败后保留、重启恢复与撤回均不丢图片，搜索不索引 Base64', async () => {
    const { host, adapter, record } = setup()
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='
    const image: ImageAttachment = {
      id: 'image-1',
      name: '测试.png',
      mediaType: 'image/png',
      bytes: Buffer.from(png, 'base64').length,
      width: 1,
      height: 1,
      dataBase64: png,
    }
    await host.send(record.id, { text: '', clientMessageId: 'image-only', attachments: [image] })
    await until(() => !!adapter.sessions[0]?.active)
    expect(adapter.sessions[0].inputs[0]).toMatchObject({ text: '', attachments: [image] })
    adapter.sessions[0].finish('failed')
    expect(host.open(record.id).queue[0]).toMatchObject({ status: 'failed', attachments: [image] })
    await host.shutdown()
    const resumed = new EngineHost({ dataDir: join(root, 'data'), adapters: { claude: adapter }, emit() {} })
    hosts.push(resumed)
    expect(resumed.open(record.id).queue[0]).toMatchObject({ attachments: [image], status: 'failed' })
    expect(resumed.open(record.id).items.find(i => i.kind === 'user')).toMatchObject({ attachments: [image] })
    expect(resumed.cancelQueued(record.id, 'image-only')).toBe('')
    expect(resumed.open(record.id).queue).toEqual([])
  })
  it('并发入队与重复请求只有一个首轮，之后依次执行，每条只出现一次', async () => {
    const { host, adapter, record, send } = setup()
    await Promise.all([send('a'), send('b'), send('b'), send('c')])
    await until(() => adapter.sessions[0]?.inputs.length === 1)
    const session = adapter.sessions[0]
    expect(session.inputs.map(i => i.id)).toEqual(['a'])
    expect(host.open(record.id).queue.map(q => q.id)).toEqual(['a', 'b', 'c'])
    session.finish()
    await until(() => session.inputs.length === 2)
    session.finish()
    await until(() => session.inputs.length === 3)
    session.finish()
    expect(host.open(record.id).queue).toEqual([])
    await send('b')
    expect(session.inputs).toHaveLength(3)
    expect(
      host
        .open(record.id)
        .items.filter(i => i.kind === 'user')
        .map(i => i.id),
    ).toEqual(['a', 'b', 'c'])
  })

  it('撤回与调序不触及当前任务；撤回返回文本，重复请求不会重新执行', async () => {
    const { host, adapter, record, send } = setup()
    await send('a')
    await until(() => !!adapter.sessions[0]?.active)
    await send('b', '原文')
    await send('c')
    host.moveQueued(record.id, 'c', 1)
    expect(host.open(record.id).queue.map(q => q.id)).toEqual(['a', 'c', 'b'])
    expect(host.cancelQueued(record.id, 'b')).toBe('原文')
    await send('b')
    expect(host.open(record.id).queue.map(q => q.id)).toEqual(['a', 'c'])
    expect(() => host.cancelQueued(record.id, 'a')).toThrow('无法撤回')
  })

  it('停止暂停队列，插队优先执行选中项并在完成后继续剩余项', async () => {
    const { host, adapter, record, send } = setup()
    await send('a')
    await until(() => !!adapter.sessions[0]?.active)
    await send('b')
    await send('c')
    await host.interrupt(record.id)
    expect(host.open(record.id).queuePaused).toBe(true)
    expect(adapter.sessions[0].inputs).toHaveLength(1)
    await host.runQueuedNow(record.id, 'c')
    expect(adapter.sessions[0].inputs.map(i => i.id)).toEqual(['a', 'c'])
    adapter.sessions[0].finish()
    await until(() => adapter.sessions[0].inputs.length === 3)
    expect(adapter.sessions[0].inputs[2].id).toBe('b')
  })

  it('检测引擎期间停止，不会在检测完成后发送原消息；插队等待派发清理', async () => {
    const { host, adapter, record, send } = setup()
    let ready!: () => void
    adapter.beforeInfo = () =>
      new Promise<void>(r => {
        ready = r
      })
    await send('a')
    await until(() => !!ready)
    await expect(host.update(record.id, { engine: 'codex' })).rejects.toThrow('排队任务')
    await send('b')
    await host.interrupt(record.id)
    ready()
    await until(() => host.open(record.id).state === 'idle')
    expect(adapter.sessions).toHaveLength(0)
    expect(host.open(record.id).queue.map(q => q.status)).toEqual(['queued', 'queued'])
    adapter.beforeInfo = null
    await host.runQueuedNow(record.id, 'b')
    expect(adapter.sessions[0].inputs[0].id).toBe('b')
  })

  it('入队模型和强度固定；执行权限跟随收紧后的选择且不改全局默认', async () => {
    const { host, adapter, record, send } = setup()
    await send('a')
    await until(() => !!adapter.sessions[0]?.active)
    await send('b')
    await host.update(record.id, { model: 'beta', effort: 'high', permissionMode: 'plan' })
    adapter.sessions[0].finish()
    await until(() => adapter.sessions[0].inputs.length === 2)
    expect(adapter.sessions[0].inputs[1].settings).toMatchObject({
      model: 'alpha',
      effort: 'low',
      permissionMode: 'plan',
    })
    expect(host.open(record.id).record).toMatchObject({ model: 'beta', effort: 'high' })
    expect(host.defaults()).toMatchObject({ model: 'beta', effort: 'high' })
    expect(host.record(record.id)?.model).toBe('alpha')
  })

  it('恢复时保留排队与交付待核对项并暂停，不自动重发已开始的消息', async () => {
    const { adapter, record, send } = setup()
    await send('a')
    await until(() => !!adapter.sessions[0]?.active)
    await send('b')
    const recoveredAdapter = new ScriptedAdapter()
    const recovered = new EngineHost({
      dataDir: join(root, 'data'),
      adapters: { claude: recoveredAdapter },
      emit: () => {},
    })
    hosts.push(recovered)
    expect(recovered.open(record.id).queue.map(q => [q.id, q.status])).toEqual([
      ['a', 'uncertain'],
      ['b', 'queued'],
    ])
    expect(recovered.open(record.id).queuePaused).toBe(true)
    // 继续队列只派发排队中的消息，待核对项留给用户处理，不会被重发。
    recovered.resumeQueue(record.id)
    await until(() => recoveredAdapter.sessions.length === 1)
    expect(recoveredAdapter.sessions[0].inputs.map(i => i.id)).toEqual(['b'])
    expect(recovered.open(record.id).queue[0]).toMatchObject({ id: 'a', status: 'uncertain' })
  })

  it('上一轮失败后空闲发送直接执行，失败项不堵塞，暂停的旧排队项保持暂停', async () => {
    const { host, adapter, record, send } = setup()
    await send('a')
    await until(() => !!adapter.sessions[0]?.active)
    await send('b')
    adapter.sessions[0].finish('failed')
    await until(() => host.open(record.id).state === 'idle')
    expect(host.open(record.id).queuePaused).toBe(true)
    await send('c')
    await until(() => adapter.sessions[0].inputs.length === 2)
    expect(adapter.sessions[0].inputs.map(i => i.id)).toEqual(['a', 'c'])
    expect(
      host
        .open(record.id)
        .items.filter(i => i.kind === 'user')
        .map(i => i.id),
    ).toEqual(['a', 'c'])
    adapter.sessions[0].finish()
    await until(() => host.open(record.id).state === 'idle')
    expect(host.open(record.id).queue.map(q => [q.id, q.status, !!q.held])).toEqual([
      ['a', 'failed', false],
      ['b', 'queued', true],
    ])
    expect(adapter.sessions[0].inputs).toHaveLength(2)
    host.resumeQueue(record.id)
    await until(() => adapter.sessions[0].inputs.length === 3)
    expect(adapter.sessions[0].inputs[2].id).toBe('b')
  })

  it('重启恢复的暂停队列下，空闲发送直接执行；运行中发送仍然排队', async () => {
    const { adapter, record, send } = setup()
    await send('a')
    await until(() => !!adapter.sessions[0]?.active)
    await send('b')
    const recoveredAdapter = new ScriptedAdapter()
    const recovered = new EngineHost({
      dataDir: join(root, 'data'),
      adapters: { claude: recoveredAdapter },
      emit: () => {},
    })
    hosts.push(recovered)
    await recovered.send(record.id, { text: 'c', clientMessageId: 'c' })
    await until(() => recoveredAdapter.sessions[0]?.inputs.length === 1)
    expect(recoveredAdapter.sessions[0].inputs[0].id).toBe('c')
    await recovered.send(record.id, { text: 'd', clientMessageId: 'd' })
    expect(recoveredAdapter.sessions[0].inputs).toHaveLength(1)
    // 直发期间新发的消息照常排在后面执行；重启前暂停的旧项仍保持暂停。
    recoveredAdapter.sessions[0].finish()
    await until(() => recoveredAdapter.sessions[0].inputs.length === 2)
    expect(recoveredAdapter.sessions[0].inputs[1].id).toBe('d')
    recoveredAdapter.sessions[0].finish()
    await until(() => recovered.open(record.id).state === 'idle')
    expect(recovered.open(record.id).queue.map(q => [q.id, q.status, !!q.held])).toEqual([
      ['a', 'uncertain', false],
      ['b', 'queued', true],
    ])
    recovered.resumeQueue(record.id)
    await until(() => recoveredAdapter.sessions[0].inputs.length === 3)
    expect(recoveredAdapter.sessions[0].inputs[2].id).toBe('b')
  })

  it('前置认证失败保留原文并暂停，后面的任务不自动执行', async () => {
    const { host, adapter, record, send } = setup({
      validateInput: async () => {
        throw new Error('账号已切换')
      },
    })
    await send('a')
    await send('b')
    await until(() => host.open(record.id).queuePaused)
    expect(host.open(record.id).queue[0]).toMatchObject({ status: 'failed', error: '账号已切换' })
    expect(adapter.sessions).toHaveLength(0)
    expect(host.cancelQueued(record.id, 'a')).toBe('a')
  })

  it('上一轮迟到的完成事件不会结束新轮或让第三条提前执行', async () => {
    const { host, adapter, record, send } = setup()
    await send('a')
    await until(() => !!adapter.sessions[0]?.active)
    const oldTurn = host.open(record.id).turnId!
    await send('b')
    await send('c')
    adapter.sessions[0].finish()
    await until(() => adapter.sessions[0].inputs.length === 2)
    const currentTurn = host.open(record.id).turnId
    adapter.sessions[0].ctx.emit({ type: 'turn_completed', turnId: oldTurn, outcome: 'completed', error: null })
    expect(host.open(record.id).turnId).toBe(currentTurn)
    expect(adapter.sessions[0].inputs.map(i => i.id)).toEqual(['a', 'b'])
  })

  it('明确重试失败任务生成新消息 UUID，保留失败尝试的历史而不覆盖', async () => {
    const { host, adapter, record, send } = setup()
    await send('a')
    await until(() => !!adapter.sessions[0]?.active)
    adapter.sessions[0].finish('failed')
    await host.runQueuedNow(record.id, 'a')
    expect(adapter.sessions[0].inputs).toHaveLength(2)
    expect(adapter.sessions[0].inputs[1].id).not.toBe('a')
    expect(host.open(record.id).items.filter(i => i.kind === 'user')).toHaveLength(2)
  })

  it('引导仅在能力已验证且设置兼容时消费，已消费项不会再自动执行', async () => {
    const { host, adapter, record, send } = setup()
    await send('a')
    await until(() => !!adapter.sessions[0]?.active)
    await send('b')
    const snapshot = host.open(record.id),
      turnId = snapshot.turnId!
    await expect(host.steerQueued(record.id, 'b', turnId)).rejects.toThrow('验证')
    adapter.sessions[0].ctx.emit({ type: 'flags', flags: { ...snapshot.flags, steerAvailable: true } })
    await host.steerQueued(record.id, 'b', turnId)
    expect(host.open(record.id).items.find(i => i.id === 'b')).toMatchObject({ mode: 'guidance', turnId })
    adapter.sessions[0].finish()
    await new Promise(r => setTimeout(r, 20))
    expect(adapter.sessions[0].inputs.map(i => i.id)).toEqual(['a'])
  })
})

describe('platform settlement lifecycle', () => {
  it('updates one persisted row, binds to the original account and turn, and restores settled history', async () => {
    let queried = ''
    const { host, adapter, record, send } = setup({
      settlementDelays: [5],
      platformCharges: async s => {
        queried = s.account
        return s.requests.map(r => ({
          requestId: r.id,
          model: r.model,
          groupId: r.groupId,
          costUsd: 0.0034,
          billing: 'balance',
          rateMultiplier: 0.2,
          input: 10,
          output: 2,
          cacheRead: 3,
          cacheWrite: 0,
        }))
      },
    })
    await host.update(record.id, { platform: { account: 'alice', groupId: '7' } })
    await send('bill-a')
    await until(() => !!adapter.sessions[0]?.active)
    const session = adapter.sessions[0],
      turnId = session.active!
    host.platformRequestContext(host.executionRecord(record.id)!)!('request-a', 'alpha')
    session.ctx.emit({
      type: 'turn_completed',
      turnId,
      outcome: 'completed',
      error: null,
      usage: { durationMs: 50, models: { alpha: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, costUsd: 99 } } },
    })
    await until(() => host.open(record.id).items.some(i => i.kind === 'turn_stats' && i.usage.settlement?.complete))
    expect(queried).toBe('alice')
    const page = host.usageList({ range: 'today', now: Date.now() + 10, filter: {}, offset: 0, limit: 10 })
    expect(page.total).toBe(1)
    expect(page.records[0]).toMatchObject({ costUsd: 0.0034, costSource: 'platform', route: 'pixelsky', input: 10 })
    session.active = null
    await host.shutdown()
    const resumed = new EngineHost({ dataDir: join(root, 'data'), emit() {} })
    hosts.push(resumed)
    expect(resumed.open(record.id).items.find(i => i.kind === 'turn_stats')).toMatchObject({
      usage: { models: { alpha: { costUsd: 0.0034 } } },
    })
  })
  it('收到 Sub2api 回传的 ID 后补到同一条请求上，按它查实扣（docs/cloud-service.md §4.9）', async () => {
    const upstream = '0b8f6d1e-4c3a-4e7b-9d2f-5a6b7c8d9e0f'
    let asked: string[] = []
    const { host, adapter, record, send } = setup({
      settlementDelays: [5],
      platformCharges: async s => {
        asked = s.requests.map(r => r.chargeId ?? r.id)
        return [
          {
            requestId: upstream,
            model: 'alpha',
            groupId: '7',
            costUsd: 0.0021,
            billing: 'balance',
            rateMultiplier: 1,
            input: 4,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
          },
        ]
      },
    })
    await host.update(record.id, { platform: { account: 'alice', groupId: '7' } })
    await send('bill-c')
    await until(() => !!adapter.sessions[0]?.active)
    const session = adapter.sessions[0],
      turnId = session.active!
    const track = host.platformRequestContext(host.executionRecord(record.id)!)!
    track('pixelsky-local', 'alpha')
    // 格式不对的 chargeId 不收
    track('pixelsky-local', 'alpha', 'not-a-uuid')
    track('pixelsky-local', 'alpha', upstream)
    session.ctx.emit({
      type: 'turn_completed',
      turnId,
      outcome: 'completed',
      error: null,
      usage: { durationMs: 50, models: { alpha: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, costUsd: 99 } } },
    })
    await until(() => host.open(record.id).items.some(i => i.kind === 'turn_stats' && i.usage.settlement?.complete))
    expect(asked).toEqual([upstream])
    const stats = host.open(record.id).items.find(i => i.kind === 'turn_stats')
    expect(stats).toMatchObject({
      usage: {
        settlement: { requests: [{ id: 'pixelsky-local', chargeId: upstream }] },
        models: { alpha: { costUsd: 0.0021 } },
      },
    })
  })
  it('does not resurrect deleted sessions or cleared usage when a delayed query finishes', async () => {
    let finish!: () => void
    const { host, adapter, record, send } = setup({
      settlementDelays: [0],
      platformCharges: async s => {
        await new Promise<void>(r => {
          finish = r
        })
        return s.requests.map(r => ({
          requestId: r.id,
          model: r.model,
          groupId: r.groupId,
          costUsd: 1,
          billing: 'balance',
          rateMultiplier: 1,
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
        }))
      },
    })
    await host.update(record.id, { platform: { account: 'alice', groupId: '7' } })
    await send('bill-b')
    await until(() => !!adapter.sessions[0]?.active)
    const session = adapter.sessions[0]
    host.platformRequestContext(host.executionRecord(record.id)!)!('request-b', 'alpha')
    session.ctx.emit({
      type: 'turn_completed',
      turnId: session.active!,
      outcome: 'completed',
      error: null,
      usage: { durationMs: 1, models: { alpha: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 20 } } },
    })
    session.active = null
    await until(() => !!finish)
    host.usageClear()
    await host.deleteSession(record.id)
    finish()
    await new Promise(r => setTimeout(r, 15))
    expect(host.record(record.id)).toBeNull()
    expect(host.usageList({ range: 'today', now: Date.now(), filter: {}, offset: 0, limit: 10 }).total).toBe(0)
  })
})

describe('消息队列：空闲时直接发送不算排队', () => {
  it('空闲发送标记为直接执行；启动期间再发的、运行中发的都是普通排队', async () => {
    const { host, adapter, record, send } = setup()
    let ready!: () => void
    adapter.beforeInfo = () =>
      new Promise<void>(r => {
        ready = r
      })
    await send('a')
    await until(() => host.open(record.id).queue[0]?.status === 'dispatching')
    expect(host.open(record.id).queue[0]).toMatchObject({ id: 'a', direct: true })
    await send('b')
    expect(host.open(record.id).queue.find(q => q.id === 'b')?.direct).toBeUndefined()
    adapter.beforeInfo = null
    ready()
    await until(() => adapter.sessions[0]?.inputs.length === 1)
    await send('c')
    expect(host.open(record.id).queue.find(q => q.id === 'c')?.direct).toBeUndefined()
    adapter.sessions[0].finish()
    await until(() => adapter.sessions[0].inputs.length === 2)
    adapter.sessions[0].finish()
    await until(() => adapter.sessions[0].inputs.length === 3)
    adapter.sessions[0].finish()
    expect(host.open(record.id).queue).toEqual([])
  })

  it('启动期间按停止：消息没开始执行，回到暂停的队列并清掉直接执行标记', async () => {
    const { host, adapter, record, send } = setup()
    let ready!: () => void
    adapter.beforeInfo = () =>
      new Promise<void>(r => {
        ready = r
      })
    await send('a')
    await until(() => host.open(record.id).queue[0]?.status === 'dispatching')
    const stopped = host.interrupt(record.id)
    ready()
    await stopped
    await until(() => host.open(record.id).queue[0]?.status === 'queued')
    expect(host.open(record.id)).toMatchObject({
      queuePaused: true,
      queue: [{ id: 'a', status: 'queued', direct: false }],
    })
    expect(adapter.sessions).toHaveLength(0)
  })

  it('直接发送失败保留标记供界面显示「发送失败」；立即执行重试时再次标记', async () => {
    let fail = true
    const { host, adapter, record, send } = setup({
      validateInput: async () => {
        if (fail) throw new Error('账号已切换')
      },
    })
    await send('a')
    await until(() => host.open(record.id).queue[0]?.status === 'failed')
    expect(host.open(record.id).queue[0]).toMatchObject({ direct: true, error: '账号已切换' })
    fail = false
    let ready!: () => void
    adapter.beforeInfo = () =>
      new Promise<void>(r => {
        ready = r
      })
    const retry = host.runQueuedNow(record.id, 'a')
    await until(() => host.open(record.id).queue[0]?.status === 'dispatching')
    expect(host.open(record.id).queue[0].direct).toBe(true)
    adapter.beforeInfo = null
    ready()
    await retry
    await until(() => adapter.sessions[0]?.inputs.length === 1)
  })

  it('队列暂停时空闲发送：旧项单独保持暂停，新消息直接执行', async () => {
    const { host, adapter, record, send } = setup()
    await send('a')
    await until(() => adapter.sessions[0]?.inputs.length === 1)
    await send('b')
    await host.interrupt(record.id)
    expect(host.open(record.id)).toMatchObject({ state: 'idle', queuePaused: true })
    await send('c')
    const queue = host.open(record.id).queue
    expect(queue.find(q => q.id === 'b')).toMatchObject({ held: true })
    expect(queue.find(q => q.id === 'c')?.direct).toBe(true)
    await until(() => adapter.sessions[0].inputs.length === 2)
    expect(adapter.sessions[0].inputs[1].id).toBe('c')
  })
})
