// 压缩上下文的实时进度：网关报来的进度对到正在进行的压缩条目上，结束时把汇总补进条目、清掉进度
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineInfo, Item, SessionSettings } from '@pixelsky/protocol'
import type { EngineAdapter, EngineSession, SessionContext } from '../src/adapter'
import type { CompactionRequestReport } from '../src/compaction'
import { EngineHost } from '../src/host'
import { ENGINES } from '../src/registry'
import { makeTmp, removeTmp } from './helpers/tmp'

let root: string
let hosts: EngineHost[]
beforeEach(() => {
  root = makeTmp('host-compaction')
  hosts = []
})
afterEach(async () => {
  await Promise.all(hosts.map(h => h.shutdown()))
  removeTmp(root)
})
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error('timeout')
}

class FakeSession implements EngineSession {
  active: string | null = null
  constructor(readonly ctx: SessionContext) {}
  send(_text: string, turnId: string) {
    this.active = turnId
  }
  async interrupt() {}
  answer() {}
  async update(_patch: Partial<SessionSettings>) {}
  async close() {}
  async stopTask() {}
  async taskOutput() {
    return { output: '', truncated: false }
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
  async update() {
    return { ok: true, output: '', version: null }
  }
}

type CompactionItem = Extract<Item, { kind: 'compaction' }>
const compaction = (patch: Partial<CompactionItem> = {}): CompactionItem => ({
  kind: 'compaction',
  id: 'compact-1',
  status: 'running',
  trigger: null,
  startedAt: 1_000,
  durationMs: null,
  preTokens: 160_000,
  postTokens: null,
  ...patch,
})
const report = (patch: Partial<CompactionRequestReport> = {}): CompactionRequestReport => ({
  requestId: 'r1',
  model: 'claude-haiku-4-5',
  requestedModel: 'claude-opus-5-5',
  requestAt: 2_000,
  connectedAt: null,
  status: null,
  firstTokenAt: null,
  lastContentAt: null,
  lastByteAt: null,
  outputTokens: 0,
  outputExact: false,
  done: false,
  error: null,
  ...patch,
})

async function running() {
  const adapter = new FakeAdapter()
  const host = new EngineHost({ dataDir: join(root, 'data'), adapters: { claude: adapter }, emit: () => {} })
  hosts.push(host)
  const project = host.addProject(root)
  const record = host.createSession({ projectId: project.id })
  await host.send(record.id, { text: '/compact', clientMessageId: 'c' })
  await until(() => !!adapter.sessions[0]?.active)
  return { host, id: record.id, session: adapter.sessions[0]! }
}

describe('压缩的实时进度', () => {
  it('对到进行中的压缩条目，结束时补上汇总并清掉进度', async () => {
    const { host, id, session } = await running()
    session.ctx.emit({ type: 'item_started', item: compaction() })
    host.compactionRequest(id, report({ connectedAt: 2_400, status: 200 }))
    expect(host.open(id).compaction).toMatchObject({
      itemId: 'compact-1',
      requests: 1,
      model: 'claude-haiku-4-5',
      connectedAt: 2_400,
    })
    host.compactionRequest(
      id,
      report({
        connectedAt: 2_400,
        status: 200,
        firstTokenAt: 5_000,
        outputTokens: 1_800,
        outputExact: true,
        done: true,
      }),
    )
    session.ctx.emit({ type: 'item_completed', item: compaction({ status: 'completed', durationMs: 9_000 }) })
    const snap = host.open(id)
    expect(snap.compaction).toBeNull()
    expect(snap.items.find(i => i.id === 'compact-1')).toMatchObject({
      status: 'completed',
      model: 'claude-haiku-4-5',
      firstTokenMs: 3_000,
      outputTokens: 1_800,
      requests: 1,
    })
  })

  it('Claude Code 重发请求时次数加一，上一次请求迟到的报告不盖掉新的', async () => {
    const { host, id, session } = await running()
    session.ctx.emit({ type: 'item_started', item: compaction() })
    host.compactionRequest(id, report({ status: 502, done: true, error: 'HTTP 502' }))
    host.compactionRequest(id, report({ requestId: 'r2', requestAt: 9_000 }))
    host.compactionRequest(id, report({ status: 502, done: true, error: 'late' }))
    expect(host.open(id).compaction).toMatchObject({ requests: 2, requestAt: 9_000, error: null })
  })

  it('报告比压缩条目先到时，条目一开始就接上', async () => {
    const { host, id, session } = await running()
    host.compactionRequest(id, report())
    expect(host.open(id).compaction ?? null).toBeNull()
    session.ctx.emit({ type: 'item_started', item: compaction() })
    expect(host.open(id).compaction).toMatchObject({ itemId: 'compact-1', requests: 1 })
  })

  it('这一轮结束时进度一起清掉', async () => {
    const { host, id, session } = await running()
    session.ctx.emit({ type: 'item_started', item: compaction() })
    host.compactionRequest(id, report())
    session.ctx.emit({ type: 'turn_completed', turnId: session.active!, outcome: 'failed', error: 'x' })
    await until(() => host.open(id).state === 'idle')
    expect(host.open(id).compaction).toBeNull()
  })
})
