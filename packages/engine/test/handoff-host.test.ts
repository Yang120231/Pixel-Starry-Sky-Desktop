// 跨引擎接力：换引擎、交接、游标、回退 / 分叉（两个假引擎：claude 和 codex）
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineId, EngineInfo, Item, SessionRecord, SessionSettings } from '@pixelsky/protocol'
import type { EngineAdapter, EngineSession, SessionContext } from '../src/adapter'
import type { EngineHostOptions } from '../src/host/context'
import { EngineHost } from '../src/host'
import { ENGINES } from '../src/registry'

let root: string
let hosts: EngineHost[]
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pixelsky-handoff-'))
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
  throw new Error('handoff timeout')
}

class FakeSession implements EngineSession {
  active: string | null = null
  inputs: string[] = []
  closed = false
  /** 创建时记录里的引擎会话 id（验证换回来时用的是原来的） */
  readonly startId: string | null
  constructor(
    readonly engine: EngineId,
    readonly ctx: SessionContext,
    readonly auto: boolean,
  ) {
    this.startId = ctx.record().engineSessionId
  }
  send(text: string, turnId: string): void {
    this.active = turnId
    this.inputs.push(text)
    if (!this.ctx.record().engineSessionId) this.ctx.setEngineSessionId(`${this.engine}-sid-${this.inputs.length}`)
    if (this.auto) setTimeout(() => this.finish(), 0)
  }
  finish(): void {
    const turnId = this.active
    this.active = null
    if (!turnId) return
    this.ctx.emit({
      type: 'item_completed',
      item: {
        kind: 'assistant',
        id: `reply-${turnId}`,
        text: `${this.engine} 的回复：${this.inputs.at(-1)!.slice(-12)}`,
        status: 'completed',
      },
    })
    this.ctx.emit({ type: 'turn_completed', turnId, outcome: 'completed', error: null })
  }
  async interrupt(): Promise<void> {
    const turnId = this.active
    this.active = null
    if (turnId) this.ctx.emit({ type: 'turn_completed', turnId, outcome: 'interrupted', error: null })
  }
  async close(): Promise<void> {
    this.closed = true
    await this.interrupt()
  }
  answer(): void {}
  async update(_patch: Partial<SessionSettings>): Promise<void> {}
  async stopTask(): Promise<void> {}
  async taskOutput() {
    return { output: '', truncated: false }
  }
}

class FakeAdapter implements EngineAdapter {
  sessions: FakeSession[] = []
  auto = true
  /** 回退时的截断点：返回 null 表示记录里找不到 */
  anchor: ((ids: string[]) => { at: string | null } | null) | null = (ids: string[]) => ({ at: `at-${ids[0]}` })
  constructor(
    readonly engine: EngineId,
    readonly enginePicksSessionId?: boolean,
  ) {}
  async info(): Promise<EngineInfo> {
    return { ...ENGINES[this.engine], status: 'ready', version: 'fake', path: 'fake', message: null }
  }
  createSession(ctx: SessionContext): FakeSession {
    const s = new FakeSession(this.engine, ctx, this.auto)
    this.sessions.push(s)
    return s
  }
  rewindAnchor(_record: SessionRecord, ids: string[]) {
    return this.anchor ? this.anchor(ids) : null
  }
}

function setup(options: Partial<EngineHostOptions> = {}) {
  const claude = new FakeAdapter('claude'),
    codex = new FakeAdapter('codex', true)
  const host = new EngineHost({ dataDir: join(root, 'data'), adapters: { claude, codex }, emit: () => {}, ...options })
  hosts.push(host)
  const project = host.addProject(root)
  const record = host.createSession({ projectId: project.id, engine: 'claude', model: 'm', effort: 'low' })
  const idle = () => host.open(record.id).state === 'idle' && host.open(record.id).queue.length === 0
  let n = 0
  const say = async (text: string, clientMessageId = `m${++n}`) => {
    await host.send(record.id, { text, clientMessageId })
    await until(() => host.open(record.id).items.some(i => i.kind === 'user' && i.id === clientMessageId))
    await until(idle)
    return clientMessageId
  }
  const snap = () => host.open(record.id)
  const users = () => snap().items.flatMap(i => (i.kind === 'user' ? [i] : [])) as Extract<Item, { kind: 'user' }>[]
  return { host, claude, codex, record, say, snap, users }
}

describe('跨引擎接力：换引擎', () => {
  it('没开始过的会话换引擎照旧：只改引擎，没有 engineSessions', async () => {
    const { host, record, snap } = setup()
    await host.update(record.id, { engine: 'codex' })
    expect(snap().record.engine).toBe('codex')
    expect(snap().record.engineSessions).toBeUndefined()
  })

  it('开始过的空闲会话可以换引擎：关进程、存旧引擎的会话 id、给新引擎新会话', async () => {
    const { host, claude, record, say, snap, users } = setup()
    await say('第一句')
    const oldId = snap().record.engineSessionId
    expect(oldId).toBeTruthy()
    // 第一轮结束后旧记录也有了 engineSessions
    expect(snap().record.engineSessions?.claude).toMatchObject({ id: oldId })
    await host.update(record.id, { engine: 'codex', model: 'gpt-x' })
    expect(claude.sessions[0].closed).toBe(true)
    expect(snap().record).toMatchObject({ engine: 'codex', nextEngine: null, model: 'gpt-x' })
    expect(snap().record.engineSessions?.claude?.id).toBe(oldId)
    expect(snap().record.engineSessions?.codex).toEqual({ id: null, seen: null })
    expect(snap().record.engineSessionId).toBeNull()
    expect(users()[0].engine).toBe('claude')
  })

  it('旧记录（没有 engineSessions、用户消息没标引擎）换引擎：补标记，旧引擎读到全部对话', async () => {
    const { host, record, say, snap, users } = setup()
    await say('第一句')
    // 模拟升级前的记录
    const rt = (
      host as unknown as { runtimes: Map<string, { snapshot: { record: SessionRecord; items: Item[] } }> }
    ).runtimes.get(record.id)!
    delete rt.snapshot.record.engineSessions
    rt.snapshot.items = rt.snapshot.items.map(i => (i.kind === 'user' ? { ...i, engine: undefined } : i))
    await host.update(record.id, { engine: 'codex' })
    expect(users()[0].engine).toBe('claude')
    const lastId = snap().items.at(-1)!.id
    expect(snap().record.engineSessions?.claude?.seen).toBe(lastId)
  })

  it('换引擎后下一条消息带交接：引擎收到的文字以交接开头，用户消息条目不变，前面有带详情的提示', async () => {
    const { host, codex, record, say, snap, users } = setup()
    await say('第一句')
    await host.update(record.id, { engine: 'codex' })
    const second = await say('第二句')
    const sent = codex.sessions[0].inputs[0]
    expect(sent.startsWith('<pixelsky-handoff')).toBe(true)
    expect(sent).toContain('用户：第一句')
    expect(sent.endsWith('\n\n第二句')).toBe(true)
    expect(users()[1]).toMatchObject({ text: '第二句', engine: 'codex' })
    const items = snap().items
    const at = items.findIndex(i => i.id === second)
    const notice = items[at - 1]
    expect(notice).toMatchObject({ kind: 'notice', level: 'info' })
    expect(notice.kind === 'notice' && notice.text).toContain('已把之前的对话交接给 Codex')
    expect(notice.kind === 'notice' && notice.detail).toContain('<pixelsky-handoff')
    // 游标推进：再发一条不带交接
    await say('第三句')
    expect(codex.sessions[0].inputs[1]).toBe('第三句')
    expect(snap().items.filter(i => i.kind === 'notice')).toHaveLength(1)
  })

  it('historyTool 为真时交接里点名历史工具，并按记录判断；为假或没给时不提', async () => {
    const seen: SessionRecord[] = []
    const { host, codex, record, say } = setup({
      historyTool: r => {
        seen.push(r)
        return true
      },
    })
    await say('第一句')
    await host.update(record.id, { engine: 'codex' })
    await say('第二句')
    expect(codex.sessions[0].inputs[0]).toContain('mcp__pixelsky_history__outline')
    expect(seen.at(-1)).toMatchObject({ id: record.id, engine: 'codex' })
    expect(Object.keys(seen.at(-1)!.engineSessions ?? {})).toHaveLength(2)
    const plain = setup()
    await plain.say('第一句')
    await plain.host.update(plain.record.id, { engine: 'codex' })
    await plain.say('第二句')
    expect(plain.codex.sessions[0].inputs[0]).not.toContain('pixelsky_history')
  })

  it('historyItems 返回会话的全部条目（副本），会话不存在时报错', async () => {
    const { host, record, say, snap } = setup()
    await say('第一句')
    const items = host.historyItems(record.id)
    expect(items.map(i => i.id)).toEqual(snap().items.map(i => i.id))
    items.pop()
    expect(host.historyItems(record.id)).toHaveLength(snap().items.length)
    expect(() => host.historyItems('nope')).toThrow()
  })

  it('换回来：恢复原来的会话 id，交接只含另一个引擎期间的内容', async () => {
    const { host, claude, record, say, snap } = setup()
    await say('第一句')
    const claudeId = snap().record.engineSessionId
    await host.update(record.id, { engine: 'codex' })
    await say('第二句')
    await host.update(record.id, { engine: 'claude' })
    expect(snap().record.engineSessionId).toBe(claudeId)
    await say('第三句')
    expect(claude.sessions[1].startId).toBe(claudeId)
    const sent = claude.sessions[1].inputs[0]
    expect(sent.startsWith('<pixelsky-handoff')).toBe(true)
    expect(sent).toContain('用户：第二句')
    expect(sent).toContain('Codex')
    expect(sent).not.toContain('用户：第一句')
    expect(sent.endsWith('\n\n第三句')).toBe(true)
    const notice = snap().items.findLast(i => i.kind === 'notice')
    expect(notice?.kind === 'notice' && notice.text).toContain('期间的进展同步给 Claude Code')
  })

  it('旧记录没有 engineSessions 时不带交接，第一轮结束后才建立游标', async () => {
    const { host, claude, record, say, snap } = setup()
    await say('第一句')
    const rt = (host as unknown as { runtimes: Map<string, { snapshot: { record: SessionRecord } }> }).runtimes.get(
      record.id,
    )!
    delete rt.snapshot.record.engineSessions
    await say('第二句')
    expect(claude.sessions[0].inputs).toEqual(['第一句', '第二句'])
    expect(snap().record.engineSessions?.claude?.seen).toBe(snap().items.at(-1)!.id)
  })

  it('运行中选别的引擎：只记 nextEngine，正在执行的不动，下一条派发的消息才真正切换', async () => {
    const { host, claude, codex, record, snap } = setup()
    claude.auto = false
    await host.send(record.id, { text: '先做', clientMessageId: 'a' })
    await until(() => !!claude.sessions[0]?.active)
    await host.update(record.id, { engine: 'codex', model: 'gpt-x' })
    expect(snap().record).toMatchObject({ engine: 'claude', nextEngine: 'codex', model: 'gpt-x' })
    expect(claude.sessions[0].closed).toBe(false)
    expect(host.record(record.id)).toMatchObject({ engine: 'claude', nextEngine: null })
    expect(snap().execution?.engine).toBe('claude')
    // 之前排的消息仍用 claude，选了之后发的用 codex
    await host.send(record.id, {
      text: '还是 claude',
      clientMessageId: 'b',
      settings: { model: 'm', effort: 'low', platform: null, engine: 'claude' },
    })
    await host.send(record.id, { text: '换 codex', clientMessageId: 'c' })
    expect(snap().queue.map(q => q.settings.engine)).toEqual(['claude', 'claude', 'codex'])
    claude.sessions[0].finish()
    await until(() => claude.sessions[0].inputs.length === 2)
    expect(snap().record.engine).toBe('claude')
    claude.sessions[0].finish()
    await until(() => codex.sessions[0]?.inputs.length === 1)
    expect(snap().record).toMatchObject({ engine: 'codex', nextEngine: null })
    expect(claude.sessions[0].closed).toBe(true)
    expect(codex.sessions[0].inputs[0].startsWith('<pixelsky-handoff')).toBe(true)
    expect(codex.sessions[0].inputs[0].endsWith('\n\n换 codex')).toBe(true)
  })

  it('运行中改回当前引擎会清掉 nextEngine', async () => {
    const { host, claude, record, snap } = setup()
    claude.auto = false
    await host.send(record.id, { text: '先做', clientMessageId: 'a' })
    await until(() => !!claude.sessions[0]?.active)
    await host.update(record.id, { engine: 'codex' })
    await host.update(record.id, { engine: 'claude' })
    expect(snap().record.nextEngine).toBeNull()
  })

  it('斜杠命令不带交接，也不推进游标；下一条普通消息再带', async () => {
    const { host, codex, record, say, snap } = setup()
    await say('第一句')
    await host.update(record.id, { engine: 'codex' })
    await say('/compact')
    expect(codex.sessions[0].inputs[0]).toBe('/compact')
    expect(snap().items.filter(i => i.kind === 'notice')).toHaveLength(0)
    expect(snap().record.engineSessions?.codex?.seen).toBeNull()
    await say('正式的问题')
    expect(codex.sessions[0].inputs[1].startsWith('<pixelsky-handoff')).toBe(true)
    expect(codex.sessions[0].inputs[1]).toContain('用户：第一句')
  })

  it('目标引擎没有的开关会被清掉', async () => {
    const { host, record, say, snap } = setup()
    await host.update(record.id, { ultracode: true })
    await say('第一句')
    expect(snap().record.ultracode).toBe(true)
    await host.update(record.id, { engine: 'codex' })
    expect(snap().record.ultracode).toBe(false)
  })
})

describe('跨引擎接力：回退、撤销、分叉', () => {
  async function threeTurns() {
    const t = setup()
    await t.say('一', 'a')
    await t.host.update(t.record.id, { engine: 'codex' })
    await t.say('二', 'b')
    await t.host.update(t.record.id, { engine: 'claude' })
    await t.say('三', 'c')
    return t
  }

  it('回退：当前引擎的游标退到它最后处理的那一轮末尾，其他引擎的原生会话作废', async () => {
    const { host, record, snap } = await threeTurns()
    // 回退到 b：保留到 b 之前一条（claude 处理的第一轮末尾，后面是交接给 codex 的提示）
    const before = snap().items[snap().items.findIndex(i => i.id === 'b') - 1].id
    expect(snap().record.engineSessions?.codex?.id).toBeTruthy()
    await host.rewind(record.id, 'b')
    expect(snap().items.map(i => i.id)).not.toContain('b')
    expect(snap().items.map(i => i.id)).not.toContain('c')
    expect(snap().record.engineSessions?.claude?.seen).toBe(before)
    expect(snap().record.engineSessions?.codex).toEqual({ id: null, seen: null })
  })

  it('回退只涉及另一个引擎处理的消息：当前引擎的会话不动', async () => {
    const { host, claude, record, say, snap } = setup()
    await say('一', 'a')
    await host.update(record.id, { engine: 'codex' })
    await say('二', 'b')
    const codexId = snap().record.engineSessionId
    await host.rewind(record.id, 'b')
    // 被回退的是 codex 自己的消息：用它的截断点
    expect(snap().record.pendingRewind).toBe('at-b')
    expect(snap().record.engineSessionId).toBe(codexId)
    expect(claude.sessions).toHaveLength(1)
  })

  it('找不到截断点：当前引擎换新会话，提示下一条消息带交接，下一条消息带完整交接', async () => {
    const { host, claude, record, say, snap } = setup()
    await say('一', 'a')
    await say('二', 'b')
    claude.anchor = null
    const oldId = snap().record.engineSessionId
    await host.rewind(record.id, 'b')
    expect(snap().record.engineSessionId).not.toBe(oldId)
    expect(snap().record.engineSessions?.claude).toMatchObject({ id: snap().record.engineSessionId, seen: null })
    const notice = snap().items.findLast(i => i.kind === 'notice')
    expect(notice).toMatchObject({ level: 'info' })
    expect(notice?.kind === 'notice' && notice.text).toContain('交接')
    await say('新的')
    const sent = claude.sessions.at(-1)!.inputs.at(-1)!
    expect(sent.startsWith('<pixelsky-handoff')).toBe(true)
    expect(sent).toContain('用户：一')
    expect(sent).not.toContain('用户：二')
  })

  it('撤销回退：engineSessions 一并恢复', async () => {
    const { host, record, snap } = await threeTurns()
    const before = JSON.stringify(snap().record.engineSessions)
    await host.rewind(record.id, 'b')
    expect(JSON.stringify(snap().record.engineSessions)).not.toBe(before)
    await host.undoRewind(record.id)
    expect(JSON.stringify(snap().record.engineSessions)).toBe(before)
    expect(snap().items.map(i => i.id)).toContain('c')
  })

  it('分叉：新会话只带当前引擎的原生会话；找不到截断点时游标为空，第一条消息带交接', async () => {
    const { host, claude, record, say, snap } = setup()
    await say('一', 'a')
    await host.update(record.id, { engine: 'codex' })
    await say('二', 'b')
    const forked = await host.forkSession(record.id, 'b')
    expect(Object.keys(forked.record.engineSessions ?? {})).toEqual(['codex'])
    expect(forked.record.nextEngine).toBeNull()
    expect(forked.record.engineSessions?.codex?.id).toBe(forked.record.engineSessionId)
    expect(snap().record.engineSessions?.claude).toBeTruthy()
    // 回到 claude 的分叉：截断点找不到
    await host.update(record.id, { engine: 'claude' })
    claude.anchor = null
    await say('三', 'c')
    const f2 = await host.forkSession(record.id, 'c')
    expect(f2.record.engineSessions?.claude?.seen).toBeNull()
    const notice = host.open(f2.record.id).items.findLast(i => i.kind === 'notice')
    expect(notice?.kind === 'notice' && notice.text).toContain('交接')
  })
})
