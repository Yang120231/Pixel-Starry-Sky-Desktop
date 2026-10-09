// EngineHost 拆分前的安全网（docs/restructure.md §8.3 P8）：
// 1. 事件序列快照：一条完整流程里广播与落盘的先后顺序，拆分后必须逐条一致；
// 2. 补没有直接测试的公开方法。期望值以拆分前的行为为准。
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EngineEvent,
  EngineInfo,
  HostEvent,
  ImageAttachment,
  SessionRecord,
  SessionSettings,
  TurnUsage,
} from '@pixelsky/protocol'
import type { EngineAdapter, EngineSession, SessionContext } from '../src/adapter'
import { EngineHost } from '../src/host'
import { ENGINES } from '../src/registry'
import { Store } from '../src/store'
import { makeTmp, removeTmp } from './helpers/tmp'

let root: string
let hosts: EngineHost[]
beforeEach(() => {
  root = makeTmp('host-event-sequence')
  hosts = []
})
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(hosts.map(h => h.shutdown()))
  removeTmp(root)
})
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error('event sequence timeout')
}

class ScriptedSession implements EngineSession {
  active: string | null = null
  inputs: string[] = []
  answers: string[] = []
  constructor(readonly ctx: SessionContext) {}
  send(text: string, turnId: string, _id: string, _attachments?: ImageAttachment[]) {
    this.active = turnId
    this.inputs.push(text)
  }
  finish(outcome: 'completed' | 'failed' | 'interrupted' = 'completed', usage?: TurnUsage) {
    const turnId = this.active!
    this.active = null
    this.ctx.emit({ type: 'turn_completed', turnId, outcome, error: null, ...(usage ? { usage } : {}) })
  }
  async interrupt() {
    if (this.active) this.finish('interrupted')
  }
  answer(requestId: string) {
    this.answers.push(requestId)
    this.ctx.emit({ type: 'approval_resolved', requestId })
  }
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
  updates = 0
  async info(): Promise<EngineInfo> {
    return { ...ENGINES.claude, status: 'ready', version: `fake-${this.updates}`, path: 'fake', message: null }
  }
  createSession(ctx: SessionContext) {
    const s = new ScriptedSession(ctx)
    this.sessions.push(s)
    return s
  }
  async update() {
    this.updates++
    return { ok: true, output: 'updated', version: null }
  }
}

/** 把广播和落盘记成一条时间线；去掉随机 ID 和时间戳，只留顺序与关键字段 */
function describeEvent(event: EngineEvent): string {
  switch (event.type) {
    case 'status':
      return `status:${event.state}`
    case 'queue':
      return `queue:[${event.items.map(q => `${q.id}=${q.status}${q.mode === 'guidance' ? '/g' : ''}`).join(',')}]${event.paused ? ' paused' : ''}`
    case 'record':
      return `record:${event.record.title}${event.record.archivedAt ? ' archived' : ''}${event.record.lastOutcome ? ` ${event.record.lastOutcome}` : ''}`
    case 'item_completed':
      return `item:${event.item.kind}${event.item.kind === 'user' ? `:${event.item.text}` : ''}`
    case 'items_truncated':
      return `truncated:${event.fromItemId}`
    case 'approval_request':
      return `approval:${event.request.requestId}`
    case 'approval_resolved':
      return `resolved:${event.requestId}`
    case 'turn_completed':
      return `turn_completed:${event.outcome}`
    case 'input_ack':
      return `ack:${event.id}:${event.state}`
    default:
      return event.type
  }
}

function setup() {
  const log: string[] = []
  for (const method of ['appendItem', 'saveRecord', 'saveQueue', 'replaceItems', 'deleteSession'] as const) {
    const original = Store.prototype[method] as (...args: unknown[]) => unknown
    vi.spyOn(Store.prototype, method).mockImplementation(function (this: Store, ...args: unknown[]) {
      const detail =
        method === 'appendItem'
          ? `:${(args[1] as { kind: string }).kind}`
          : method === 'saveQueue'
            ? `:${(args[1] as { items: unknown[] }).items.length}`
            : ''
      log.push(`store.${method}${detail}`)
      return original.apply(this, args)
    })
  }
  const adapter = new ScriptedAdapter()
  const events: HostEvent[] = []
  const host = new EngineHost({
    dataDir: join(root, 'data'),
    adapters: { claude: adapter },
    emit: e => {
      events.push(e)
      if (e.kind === 'session') log.push(`emit.session#${e.seq} ${describeEvent(e.event)}`)
      else log.push(`emit.${e.kind}`)
    },
  })
  hosts.push(host)
  return { host, adapter, events, log }
}

const usage: TurnUsage = {
  durationMs: 1000,
  models: { alpha: { input: 10, cacheRead: 0, cacheWrite: 0, output: 5, costUsd: 0.01, requests: 1 } },
}

describe('EngineHost 事件序列快照', () => {
  it('发送 → 审批 → 完成 → 队列接续 → 引导 → 中断 → 回退 → 归档 → 删除', async () => {
    const { host, adapter, log } = setup()
    const project = host.addProject(root)
    const record = host.createSession({ projectId: project.id, model: 'alpha', effort: 'low' })
    const id = record.id
    log.push('--- send a')
    await host.send(id, { text: 'a', clientMessageId: 'a' })
    await until(() => !!adapter.sessions[0]?.active)
    const session = adapter.sessions[0]

    log.push('--- output + approval')
    session.ctx.emit({ type: 'item_completed', item: { kind: 'assistant', id: 'r1', text: '好', status: 'completed' } })
    session.ctx.emit({
      type: 'approval_request',
      request: { requestId: 'q1', itemId: null, kind: 'command', title: '运行命令', command: 'ls', alwaysScopes: [] },
    })
    host.answer(id, 'q1', { type: 'allow' })

    log.push('--- queue b, finish a')
    await host.send(id, { text: 'b', clientMessageId: 'b' })
    session.finish('completed', usage)
    await until(() => session.inputs.length === 2)

    log.push('--- queue c, steer c')
    await host.send(id, { text: 'c', clientMessageId: 'c' })
    const snapshot = host.open(id)
    session.ctx.emit({ type: 'flags', flags: { ...snapshot.flags, steerAvailable: true } })
    await host.steerQueued(id, 'c', snapshot.turnId!)

    log.push('--- interrupt')
    await host.interrupt(id)
    await until(() => host.open(id).state === 'idle')

    log.push('--- rewind b')
    await host.rewind(id, 'b')

    log.push('--- archive')
    await host.archiveSession(id, true)

    log.push('--- delete')
    await host.deleteSession(id)
    await new Promise(r => setTimeout(r, 20))

    expect(session.answers).toEqual(['q1'])
    expect(log).toMatchSnapshot()
  })
})

describe('EngineHost 补充表征', () => {
  it('updateEngine：交给适配器更新，再重新检测并广播，返回检测到的版本', async () => {
    const { host, adapter, events } = setup()
    const result = await host.updateEngine('claude')
    expect(adapter.updates).toBe(1)
    expect(result).toEqual({ ok: true, output: 'updated', version: 'fake-1' })
    expect(events.some(e => e.kind === 'engines')).toBe(true)
    await expect(host.updateEngine('codex')).rejects.toThrow('这个引擎不支持在软件里更新')
  })

  it('setDefaults：写到指定引擎名下，不改默认引擎，校验字段', () => {
    const { host } = setup()
    const before = host.defaults()
    const after = host.setDefaults({ engine: 'codex', model: ' gpt ', fast: true })
    expect(after.engine).toBe(before.engine)
    expect(host.engineConfig().codex.defaults).toMatchObject({ model: 'gpt', fast: true })
    expect(host.engineConfig().claude.defaults.model).toBe(before.model)
    expect(() => host.setDefaults({ effort: 'nope' as never })).toThrow('默认推理强度不对')
    expect(() => host.setDefaults({ fast: 'yes' as never })).toThrow('默认设置 fast 的值不对')
  })

  it('usageCsv / record / executionRecord / platformRequestContext', async () => {
    const { host, adapter } = setup()
    const project = host.addProject(root)
    const record = host.createSession({ projectId: project.id, model: 'alpha' })
    expect(host.record(record.id)).toEqual(record)
    expect(host.executionRecord(record.id)).toEqual(record)
    expect(host.record('missing')).toBeNull()
    expect(host.platformRequestContext(record as SessionRecord)).toBeUndefined()
    await host.send(record.id, { text: 'a', clientMessageId: 'a' })
    await until(() => !!adapter.sessions[0]?.active)
    expect(host.executionRecord(record.id)).toEqual(host.record(record.id))
    expect(host.executionRecord(record.id)?.model).toBe('alpha')
    adapter.sessions[0].finish('completed', usage)
    await until(() => host.open(record.id).state === 'idle')
    const csv = host.usageCsv({ range: 'today', filter: {}, now: Date.now() + 1 } as never)
    expect(csv.split('\n')[0]).toContain(',')
    expect(csv).toContain('alpha')
  })
})
