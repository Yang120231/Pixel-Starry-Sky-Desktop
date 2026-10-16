// 跨引擎接力：换引擎、交接、游标、回退 / 分叉（两个假引擎：claude 和 codex）
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineId, EngineInfo, Item, SessionRecord, SessionSettings } from '@pixelsky/protocol'
import type { EngineAdapter, EngineSession, SessionContext } from '../src/adapter'
import type { ChatSeed } from '../src/chat-log'
import type { EngineHostOptions } from '../src/host/context'
import { EngineHost } from '../src/host'
import { derivedSeen } from '../src/host/handoff'
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
  /** 每次 send 收到的聊天回放（没有为 undefined） */
  seeds: (ChatSeed | undefined)[] = []
  closed = false
  /** 创建时记录里的引擎会话 id（验证换回来时用的是原来的） */
  readonly startId: string | null
  constructor(
    readonly engine: EngineId,
    readonly ctx: SessionContext,
    public auto: boolean,
  ) {
    this.startId = ctx.record().engineSessionId
  }
  send(text: string, turnId: string, _userItemId: string, _attachments?: unknown, seed?: ChatSeed): void {
    this.active = turnId
    this.inputs.push(text)
    this.seeds.push(seed)
    if (!this.ctx.record().engineSessionId) this.ctx.setEngineSessionId(`${this.engine}-sid-${this.inputs.length}`)
    if (this.auto) setTimeout(() => this.finish(), 0)
  }
  finish(outcome: 'completed' | 'failed' = 'completed'): void {
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
    this.ctx.emit({
      type: 'turn_completed',
      turnId,
      outcome,
      error: outcome === 'failed' ? 'connection reset by peer' : null,
    })
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
    readonly seedsHistory?: boolean,
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

function setup(options: Partial<EngineHostOptions> = {}, seeds = false) {
  const claude = new FakeAdapter('claude', false, seeds),
    codex = new FakeAdapter('codex', true, seeds)
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

  it('能注入聊天的引擎：消息原样发，之前的聊天作为回放交给适配器，文字交接只当兜底', async () => {
    const { host, codex, record, say, snap } = setup({}, true)
    await say('第一句')
    await host.update(record.id, { engine: 'codex' })
    await say('第二句')
    const session = codex.sessions[0]
    expect(session.inputs[0]).toBe('第二句')
    const seed = session.seeds[0]!
    expect(seed.turns).toEqual([{ id: 'm1', user: '第一句', assistant: 'claude 的回复：第一句' }])
    expect(seed.overview).toBeNull()
    expect(seed.fallback.startsWith('<pixelsky-handoff')).toBe(true)
    const notice = snap().items.findLast(i => i.kind === 'notice')
    expect(notice).toMatchObject({ kind: 'notice', level: 'info', text: '已把之前的聊天带给 Codex（1 轮）' })
    expect(notice?.kind === 'notice' && notice.detail).toBe('用户：第一句\n助手：claude 的回复：第一句')
    // 游标推进：再发一条不带回放
    await say('第三句')
    expect(session.inputs[1]).toBe('第三句')
    expect(session.seeds[1]).toBeUndefined()
  })

  it('能注入聊天的引擎换回来：回放只含另一个引擎期间的轮次', async () => {
    const { host, claude, record, say, snap } = setup({}, true)
    await say('第一句')
    await host.update(record.id, { engine: 'codex' })
    await say('第二句')
    await host.update(record.id, { engine: 'claude' })
    await say('第三句')
    const session = claude.sessions[1]
    expect(session.inputs[0]).toBe('第三句')
    expect(session.seeds[0]!.turns.map(t => t.user)).toEqual(['第二句'])
    const notice = snap().items.findLast(i => i.kind === 'notice')
    expect(notice?.kind === 'notice' && notice.text).toBe('已把 Codex 期间的聊天同步给 Claude Code（1 轮）')
  })

  it.each([false, true])('同一引擎报错后重试：保留上下文恢复，不显示换引擎提示（聊天回放：%s）', async seeds => {
    const { host, claude, record, say, snap } = setup({}, seeds)
    await say('第一句')
    const session = claude.sessions[0]
    const seen = snap().record.engineSessions?.claude?.seen
    session.auto = false
    await host.send(record.id, { text: '失败的一轮', clientMessageId: 'failed' })
    await until(() => session.inputs.length === 2)
    session.finish('failed')
    expect(snap().record.engineSessions?.claude?.seen).toBe(seen)
    await host.runQueuedNow(record.id, 'failed')
    await until(() => session.inputs.length === 3)
    expect(snap().record.engine).toBe('claude')
    expect(snap().items.filter(i => i.kind === 'notice')).toHaveLength(0)
    if (seeds) expect(session.seeds[2]?.turns.map(t => t.user)).toContain('失败的一轮')
    else expect(session.inputs[2]).toContain('用户：失败的一轮')
    session.finish()
    await until(() => snap().state === 'idle' && snap().queue.length === 0)
    expect(snap().record.engineSessions?.claude?.seen).toBe(snap().items.at(-1)!.id)
  })

  it.each([false, true])(
    '换引擎后的首轮报错：重试继续补发交接，但不重复显示换引擎提示（聊天回放：%s）',
    async seeds => {
      const { host, codex, record, say, snap } = setup({}, seeds)
      await say('第一句')
      await host.update(record.id, { engine: 'codex' })
      codex.auto = false
      await host.send(record.id, { text: '第二句', clientMessageId: 'failed' })
      await until(() => codex.sessions[0]?.inputs.length === 1)
      const session = codex.sessions[0]
      expect(snap().items.filter(i => i.kind === 'notice')).toHaveLength(1)
      session.finish('failed')
      await host.runQueuedNow(record.id, 'failed')
      await until(() => session.inputs.length === 2)
      expect(snap().record.engine).toBe('codex')
      expect(snap().items.filter(i => i.kind === 'notice')).toHaveLength(1)
      if (seeds) expect(session.seeds[1]?.turns.map(t => t.user)).toContain('第一句')
      else expect(session.inputs[1]).toContain('用户：第一句')
      session.finish()
      await until(() => snap().state === 'idle' && snap().queue.length === 0)
    },
  )

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

  it('回退到交接给当前引擎的消息之前：截断点按它上下文里最早被移除的消息算，不只看它自己处理的', async () => {
    const { host, claude, record, snap } = await threeTurns()
    const asked: string[][] = []
    claude.anchor = ids => (asked.push(ids), { at: `at-${ids[0]}` })
    await host.rewind(record.id, 'b')
    // b 是 codex 处理的，换回 claude 时交接进了 claude 的原生会话
    expect(asked).toEqual([['b', 'c']])
    expect(snap().record.pendingRewind).toBe('at-b')
  })

  it('回退的消息还没交接给当前引擎（在它的游标之后）：当前引擎的会话不动', async () => {
    const { host, claude, record, say, snap } = setup()
    await say('一', 'a')
    await host.update(record.id, { engine: 'codex' })
    await say('二', 'b')
    await host.update(record.id, { engine: 'claude' })
    const asked: string[][] = []
    claude.anchor = ids => (asked.push(ids), null)
    const claudeId = snap().record.engineSessionId
    await host.rewind(record.id, 'b')
    expect(asked).toEqual([])
    expect(snap().record.engineSessionId).toBe(claudeId)
    expect(snap().record.pendingRewind ?? null).toBeNull()
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

  /** claude 一，切 codex 二，切回 claude 发 /compact（暂缓交接）再发三 */
  async function heldSlashThenTurn() {
    const t = setup()
    await t.say('一', 'a')
    await t.host.update(t.record.id, { engine: 'codex' })
    await t.say('二', 'b')
    await t.host.update(t.record.id, { engine: 'claude' })
    await t.say('/compact', 's')
    await t.say('三', 'c')
    return t
  }

  it('回退：重建游标时跳过暂缓交接的斜杠命令那一轮，下一条消息仍带交接', async () => {
    const { host, claude, record, say, snap } = await heldSlashThenTurn()
    const before = snap().items[snap().items.findIndex(i => i.id === 'b') - 1].id
    await host.rewind(record.id, 'c')
    expect(snap().items.map(i => i.id)).toContain('s')
    expect(snap().items.map(i => i.id)).not.toContain('c')
    expect(snap().record.engineSessions?.claude?.seen).toBe(before)
    await say('四')
    const sent = claude.sessions.at(-1)!.inputs.at(-1)!
    expect(sent.startsWith('<pixelsky-handoff')).toBe(true)
    expect(sent).toContain('用户：二')
  })

  it('分叉：重建游标时跳过暂缓交接的斜杠命令那一轮，分叉里第一条消息仍带交接', async () => {
    const { host, claude, snap } = await heldSlashThenTurn()
    const before = snap().items[snap().items.findIndex(i => i.id === 'b') - 1].id
    const forked = await host.forkSession(snap().record.id, 'c')
    expect(forked.record.engineSessions?.claude?.seen).toBe(before)
    const forkId = forked.record.id
    await host.send(forkId, { text: '四', clientMessageId: 'd' })
    await until(() => host.open(forkId).items.some(i => i.kind === 'user' && i.id === 'd'))
    await until(() => host.open(forkId).state === 'idle' && host.open(forkId).queue.length === 0)
    const sent = claude.sessions.at(-1)!.inputs.at(-1)!
    expect(sent.startsWith('<pixelsky-handoff')).toBe(true)
    expect(sent).toContain('用户：二')
  })

  it('回退：没有可交接的内容时斜杠命令那一轮正常推进游标，下一条消息不带交接', async () => {
    const { host, claude, record, say, snap } = setup()
    await say('a1', 'a')
    await say('/compact', 's')
    await say('b1', 'b')
    const before = snap().items[snap().items.findIndex(i => i.id === 'b') - 1].id
    await host.rewind(record.id, 'b')
    expect(snap().record.engineSessions?.claude?.seen).toBe(before)
    await say('四')
    expect(claude.sessions.at(-1)!.inputs.at(-1)).toBe('四')
  })
})

describe('derivedSeen', () => {
  const user = (id: string, engine?: EngineId, text = id, mode?: 'guidance'): Item => ({
    kind: 'user',
    id,
    text,
    createdAt: 0,
    ...(engine ? { engine } : {}),
    ...(mode ? { mode } : {}),
  })
  const reply = (id: string): Item => ({ kind: 'assistant', id, text: id, status: 'completed' })

  it('没有该引擎的用户消息为 null', () => {
    expect(derivedSeen([user('u1', 'codex'), reply('r1')], 'claude', 'claude')).toBeNull()
  })

  it('普通消息：游标是它所在一轮的末尾', () => {
    const items = [user('u1', 'claude'), reply('r1'), user('u2', 'codex'), reply('r2')]
    expect(derivedSeen(items, 'claude', 'claude')).toBe('r1')
  })

  it('斜杠命令前面有没交接的内容：不推进游标', () => {
    const items = [
      user('u1', 'claude'),
      reply('r1'),
      user('u2', 'codex'),
      reply('r2'),
      user('u3', 'claude', '/compact'),
    ]
    expect(derivedSeen(items, 'claude', 'claude')).toBe('r1')
  })

  it('斜杠命令前面没有可交接的内容：照常推进', () => {
    const items = [user('u1', 'claude'), reply('r1'), user('u2', 'claude', '/compact'), reply('r2')]
    expect(derivedSeen(items, 'claude', 'claude')).toBe('r2')
  })

  it('开头就是斜杠命令且前面没有内容：推进；只有暂缓的斜杠命令时为 null', () => {
    expect(derivedSeen([user('u1', 'claude', '/init'), reply('r1')], 'claude', 'claude')).toBe('r1')
    const held = [user('u1', 'codex'), reply('r1'), user('u2', 'claude', '/compact')]
    expect(derivedSeen(held, 'claude', 'claude')).toBeNull()
  })

  it('中途补充以斜杠开头不算斜杠命令；没标引擎的消息按 fallback 算', () => {
    const items = [user('u1', 'codex'), reply('r1'), user('u2', undefined, '/x', 'guidance')]
    expect(derivedSeen(items, 'claude', 'claude')).toBe('u2')
  })
})
