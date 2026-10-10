import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostEvent, RequestCacheUsage } from '@pixelsky/protocol'
import { ClaudeAdapter, EngineHost, ENGINES, type EngineAdapter, type SessionContext } from '../src'

const roots: string[] = []
const hosts: EngineHost[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(h => h.shutdown()))
  roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true }))
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pixelsky-cache-test-'))
  roots.push(root)
  const events: HostEvent[] = [],
    contexts = new Map<string, SessionContext>(),
    active = new Map<string, string>()
  let interrupts = 0
  const adapter: EngineAdapter = {
    info: async () => ({ ...ENGINES.claude, status: 'ready', version: 'test', path: 'test', message: null }),
    createSession: ctx => {
      const id = ctx.record().id
      contexts.set(id, ctx)
      return {
        send: (_text, turnId) => {
          active.set(id, turnId)
        },
        interrupt: async () => {
          interrupts++
          const turnId = active.get(id)
          if (turnId) {
            active.delete(id)
            ctx.emit({ type: 'turn_completed', turnId, outcome: 'interrupted', error: null })
          }
        },
        answer: () => {},
        update: async () => {},
        stopTask: async () => {},
        taskOutput: async () => ({ output: '', truncated: false }),
        close: async () => {
          const turnId = active.get(id)
          if (turnId) {
            active.delete(id)
            ctx.emit({ type: 'turn_completed', turnId, outcome: 'interrupted', error: null })
          }
        },
      }
    },
  }
  const host = new EngineHost({ dataDir: join(root, 'data'), adapters: { claude: adapter }, emit: e => events.push(e) })
  hosts.push(host)
  const project = host.addProject(root)
  const create = () => host.createSession({ projectId: project.id, engine: 'claude' }).id
  const begin = async (id: string) => {
    await host.send(id, '缓存测试')
    await vi.waitFor(() => expect(host.open(id).turnId).not.toBeNull())
    return host.open(id).turnId!
  }
  const emit = (id: string, turnId: string, input: number, cacheRead = 0, messageId = String(Math.random())) => {
    const request: RequestCacheUsage = {
      turnId,
      messageId,
      model: 'opus',
      input,
      cacheRead,
      cacheWrite: 0,
      observedAt: Date.now(),
    }
    contexts.get(id)!.emit({ type: 'request_usage', request })
  }
  const finish = (id: string, turnId: string) => {
    active.delete(id)
    contexts.get(id)!.emit({ type: 'turn_completed', turnId, outcome: 'completed', error: null })
  }
  const warnings = () => events.filter(e => e.kind === 'cache_warning')
  return { host, create, begin, emit, finish, warnings, contexts, interrupts: () => interrupts }
}

describe('缓存提醒宿主与停止目标', () => {
  it('实际子进程 stream-json → 翻译器 → 宿主提醒 → 对应轮次中断', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pixelsky-cache-process-'))
    roots.push(root)
    const events: HostEvent[] = []
    const adapter = new ClaudeAdapter({
      launcher: {
        command: process.execPath,
        args: [fileURLToPath(new URL('./fakes/fake-claude.mjs', import.meta.url))],
      },
      projectsDir: join(root, 'projects'),
      env: { ...process.env, FAKE_CLAUDE_CACHE_ALERT: '1' },
    })
    const host = new EngineHost({
      dataDir: join(root, 'data'),
      emit: e => events.push(e),
      adapters: { claude: adapter },
    })
    hosts.push(host)
    const project = host.addProject(root),
      record = host.createSession({ projectId: project.id })
    await host.send(record.id, '慢慢回复')
    await vi.waitFor(() => expect(events.some(e => e.kind === 'cache_warning')).toBe(true), { timeout: 5000 })
    const warning = events.find(e => e.kind === 'cache_warning')!
    if (warning.kind !== 'cache_warning') throw new Error('missing warning')
    expect(warning.warning).toMatchObject({ input: 12000, cached: 0, previousInput: 10000 })
    expect(host.open(record.id).state).toBe('running')
    expect(await host.interruptTurn(record.id, warning.warning.turnId)).toBe(true)
    expect(host.open(record.id).record.lastOutcome).toBe('interrupted')
    expect(events.filter(e => e.kind === 'cache_warning')).toHaveLength(1)
    expect(host.open(record.id).queuePaused).toBe(true)
  })
  it('一轮最多一次，跨轮继续比较，多会话分别建立基线，瞬时数据不进快照', async () => {
    const e = setup(),
      id = e.create(),
      other = e.create(),
      turn = await e.begin(id)
    e.emit(id, turn, 10000)
    e.emit(id, turn, 12000, 0, 'miss')
    e.emit(id, turn, 14000, 0)
    expect(e.warnings()).toHaveLength(1)
    expect(e.warnings()[0]).toMatchObject({
      warning: { sessionId: id, turnId: turn, title: '缓存测试', input: 12000, previousInput: 10000 },
    })
    const otherTurn = await e.begin(other)
    e.emit(other, otherTurn, 20000)
    expect(e.warnings()).toHaveLength(1)
    e.finish(id, turn)
    const next = await e.begin(id)
    e.emit(id, next, 16000)
    expect(e.warnings()).toHaveLength(2)
    expect(e.host.open(id).items.some(i => i.kind === 'notice')).toBe(false)
  })
  it('旧提醒不暂停或中断下一轮，正确轮次停止且阻止排队消息自动派发', async () => {
    const e = setup(),
      id = e.create(),
      old = await e.begin(id)
    e.finish(id, old)
    const current = await e.begin(id)
    expect(await e.host.interruptTurn(id, old)).toBe(false)
    expect(e.host.open(id).queuePaused).toBe(false)
    expect(e.interrupts()).toBe(0)
    await e.host.send(id, '下一条排队消息')
    expect(await e.host.interruptTurn(id, current)).toBe(true)
    expect(e.interrupts()).toBe(1)
    expect(e.host.open(id).turnId).toBeNull()
    expect(e.host.open(id).queuePaused).toBe(true)
    expect(e.host.open(id).queue.some(q => q.text === '下一条排队消息')).toBe(true)
    expect(await e.host.interruptTurn(id, current)).toBe(false)
  })
  it('压缩/进程重置、模型/线路切换后不沿用旧缓存基线，过期原始事件被忽略', async () => {
    const e = setup(),
      id = e.create(),
      turn = await e.begin(id)
    e.emit(id, turn, 10000)
    e.contexts.get(id)!.emit({ type: 'request_cache_reset' })
    e.emit(id, turn, 12000)
    expect(e.warnings()).toHaveLength(0)
    await e.host.update(id, { model: 'sonnet' })
    e.emit(id, turn, 14000)
    expect(e.warnings()).toHaveLength(0)
    e.emit(id, 'old-turn', 16000)
    expect(e.warnings()).toHaveLength(0)
  })
})
