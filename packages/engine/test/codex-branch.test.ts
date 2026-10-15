// Codex 回退 / 分叉（docs/codex-engine.md「回退与分叉」）：截断点纯函数 + 宿主 + 假 Codex
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HostEvent } from '@pixelsky/protocol'
import { CodexAdapter, EngineHost } from '../src'
import { codexAnchor, revertTarget, turnInfo, type CodexTurnInfo } from '../src/codex/branch'
import { makeTmp, removeTmp } from './helpers/tmp'

const turn = (id: string, ...clientIds: string[]): CodexTurnInfo => ({ id, clientIds })

describe('Codex 截断点（纯函数）', () => {
  const turns = [turn('t1', 'm0'), turn('t2', 'm1'), turn('t3', 'm2', 'g1')]
  it('普通：最早含有被移除消息的一轮的前一轮', () => {
    expect(codexAnchor(turns, ['m1', 'm2'])).toEqual({ at: 't1' })
    expect(codexAnchor(turns, ['m2', 'g1'])).toEqual({ at: 't2' })
    // 被移除的 id 顺序不影响：按轮次位置找最早的
    expect(codexAnchor(turns, ['g1', 'm1'])).toEqual({ at: 't1' })
  })
  it('同一轮里还有保留的消息（steer 追加进当前轮）：整轮截不开，找不到', () => {
    // 回退 / 分叉到 g1：m2 要保留，但它和 g1 在同一轮
    expect(codexAnchor(turns, ['g1'])).toBeNull()
    expect(codexAnchor([turn('t1', 'm0', 'g0')], ['g0'])).toBeNull()
  })
  it('回退到第一条：一轮都不保留', () => {
    expect(codexAnchor(turns, ['m0', 'm1', 'm2'])).toEqual({ at: null })
  })
  it('被移除的消息没发到 Codex：保留全部轮次', () => {
    expect(codexAnchor(turns, ['never-sent'])).toEqual({ at: 't3' })
  })
  it('没有 clientId（老会话）或读不到轮次：找不到', () => {
    expect(codexAnchor([turn('t1'), turn('t2')], ['m0'])).toBeNull()
    expect(codexAnchor([], ['m0'])).toBeNull()
  })
  it('revertTarget：at 的下一轮；at 是最后一轮不用动；找不到', () => {
    expect(revertTarget(turns, 't1')).toBe('t2')
    expect(revertTarget(turns, 't2')).toBe('t3')
    expect(revertTarget(turns, 't3')).toBeNull()
    expect(revertTarget(turns, 'nope')).toBe('missing')
  })
  it('turnInfo：只取用户消息的 clientId', () => {
    expect(
      turnInfo({
        id: 't9',
        items: [
          { type: 'userMessage', clientId: 'a' },
          { type: 'agentMessage', clientId: 'x' },
          { type: 'userMessage', clientId: null },
          { type: 'userMessage', clientId: 'b' },
        ],
      }),
    ).toEqual({ id: 't9', clientIds: ['a', 'b'] })
  })
})

let root: string, host: EngineHost | undefined, events: HostEvent[]
beforeEach(() => {
  root = makeTmp('codex-branch')
  events = []
})
afterEach(async () => {
  await host?.shutdown()
  host = undefined
  removeTmp(root)
})
const wait = async (fn: () => boolean): Promise<void> => {
  for (let i = 0; i < 500; i++) {
    if (fn()) return
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error('Codex test timed out')
}
const stateFile = (): string => join(root, 'state', 'threads.json')
const threads = (): Record<string, { id: string; clientId: string | null }[]> =>
  JSON.parse(readFileSync(stateFile(), 'utf8'))
const clientIds = (thread: string): (string | null)[] => threads()[thread].map(t => t.clientId)

function setup(env: Record<string, string> = {}) {
  const log = join(root, 'rpc.jsonl')
  const adapter = new CodexAdapter({
    launcher: { command: process.execPath, args: [fileURLToPath(new URL('./fakes/fake-codex.mjs', import.meta.url))] },
    env: { ...process.env, FAKE_CODEX_LOG: log, FAKE_CODEX_STATE_DIR: join(root, 'state'), ...env },
    launchOptions: () => ({ askQuestions: true, steeringValidated: true }),
  })
  host = new EngineHost({
    dataDir: join(root, 'engine'),
    adapters: { codex: adapter },
    emit: e => events.push(e),
    idleMs: 60_000,
  })
  const session = host.createSession({
    projectId: host.addProject(root).id,
    engine: 'codex',
    model: 'fake-codex',
    effort: 'high',
    permissionMode: 'ask',
  })
  const messages = (): { method?: string; params?: Record<string, unknown> }[] =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map(line => JSON.parse(line))
      : []
  /** 发一条消息并等这一轮结束；消息 id 为 m0、m1… */
  const say = async (sessionId: string, text: string, clientMessageId: string): Promise<void> => {
    const done = () => host!.open(sessionId).items.filter(i => i.kind === 'turn_stats').length
    const before = done()
    await host!.send(sessionId, { text, clientMessageId })
    await wait(() => done() === before + 1 && host!.open(sessionId).state === 'idle')
  }
  const conversation = async (texts: string[]): Promise<void> => {
    for (const [i, text] of texts.entries()) await say(session.id, text, `m${i}`)
  }
  return { adapter, session, messages, say, conversation }
}
const methods = (list: { method?: string }[]): (string | undefined)[] => list.map(m => m.method)
const notices = (id: string): string[] => host!.open(id).items.flatMap(i => (i.kind === 'notice' ? [i.text] : []))

// 每条要起几个假 Codex 进程（会话 + 读轮次的临时进程），完整检查并发跑时会超过默认的 5 秒
describe('Codex 回退', { timeout: 20_000 }, () => {
  it('回退后下次发消息先 thread/revert（beforeTurnId 是被移除的第一轮）再 turn/start；轮次分页也能定位', async () => {
    const { session, messages, say, conversation } = setup({ FAKE_CODEX_PAGE: '1' })
    await conversation(['一', '二', '三'])
    const result = await host!.rewind(session.id, 'm1')
    expect(result.text).toBe('二')
    // 截断点 = 最后保留的一轮；Codex 记录这时还没动
    expect(host!.open(session.id).record.pendingRewind).toBe('turn-1')
    expect(clientIds('fake-thread')).toEqual(['m0', 'm1', 'm2'])
    const from = messages().length
    await say(session.id, '新的', 'n0')
    const sent = messages().slice(from)
    expect(sent.filter(m => m.method === 'thread/revert')).toEqual([
      expect.objectContaining({ params: { threadId: 'fake-thread', beforeTurnId: 'turn-2' } }),
    ])
    const order = methods(sent)
    expect(order.indexOf('thread/resume')).toBeLessThan(order.indexOf('thread/revert'))
    expect(order.indexOf('thread/revert')).toBeLessThan(order.indexOf('turn/start'))
    expect(clientIds('fake-thread')).toEqual(['m0', 'n0'])
    expect(host!.open(session.id).record.pendingRewind ?? null).toBeNull()
    expect(notices(session.id)).toEqual([])
  })

  it('回退后撤销再发：不调 thread/revert，上下文完整', async () => {
    const { session, messages, say, conversation } = setup()
    await conversation(['一', '二', '三'])
    await host!.rewind(session.id, 'm1')
    await host!.undoRewind(session.id)
    expect(host!.open(session.id).record.pendingRewind ?? null).toBeNull()
    const from = messages().length
    await say(session.id, '四', 'n0')
    expect(methods(messages().slice(from))).not.toContain('thread/revert')
    expect(clientIds('fake-thread')).toEqual(['m0', 'm1', 'm2', 'n0'])
  })

  it('回退到最后一条之外的消息都没发到 Codex：保留全部、不调 thread/revert', async () => {
    const { session, messages, say, conversation } = setup()
    await conversation(['一', '二'])
    // 界面里有这条消息、Codex 里没有：把 m1 的 clientId 改掉模拟发送失败
    const data = threads()
    data['fake-thread'][1].clientId = 'other'
    writeFileSync(stateFile(), JSON.stringify(data))
    await host!.rewind(session.id, 'm1')
    expect(host!.open(session.id).record.pendingRewind).toBe('turn-2')
    const from = messages().length
    await say(session.id, '三', 'n0')
    expect(methods(messages().slice(from))).not.toContain('thread/revert')
    expect(clientIds('fake-thread')).toEqual(['m0', 'other', 'n0'])
  })

  it('回退到第一条：开新线程，不 resume、不 revert，也没有提示', async () => {
    const { session, messages, say, conversation } = setup()
    await conversation(['一', '二'])
    await host!.rewind(session.id, 'm0')
    const record = host!.open(session.id).record
    expect(record.engineSessionId ?? null).toBeNull()
    expect(record.pendingRewind ?? null).toBeNull()
    const from = messages().length
    await say(session.id, '新的', 'n0')
    const sent = methods(messages().slice(from))
    expect(sent).toContain('thread/start')
    expect(sent).not.toContain('thread/resume')
    expect(sent).not.toContain('thread/revert')
    expect(host!.open(session.id).record.engineSessionId).not.toBe('fake-thread')
    expect(notices(session.id)).toEqual([])
  })

  it('找不到截断点（Codex 记录没了）：新线程 + 提示里写 Codex', async () => {
    const { session, say, conversation } = setup()
    await conversation(['一', '二'])
    rmSync(stateFile())
    await host!.rewind(session.id, 'm1')
    expect(host!.open(session.id).record.engineSessionId ?? null).toBeNull()
    expect(notices(session.id)).toEqual([
      '无法在 Codex 记录中回退到这条消息，已开始新的引擎会话（之前的上下文没有带过去）',
    ])
    await say(session.id, '新的', 'n0')
    expect(host!.open(session.id).record.engineSessionId).toBeTruthy()
  })

  it('启动时 thread/revert 失败（截断点已不在记录里）：改开新线程并提示', async () => {
    const { session, say, conversation } = setup()
    await conversation(['一', '二', '三'])
    await host!.rewind(session.id, 'm1')
    // 回退之后、下次启动之前记录被改动：turn-2 不见了
    const data = threads()
    data['fake-thread'] = data['fake-thread'].filter(t => t.id !== 'turn-1')
    writeFileSync(stateFile(), JSON.stringify(data))
    await say(session.id, '新的', 'n0')
    expect(notices(session.id)).toEqual([
      'Could not rewind the Codex thread to this message; started a new thread (previous context was not carried over)',
    ])
    expect(host!.open(session.id).record.pendingRewind ?? null).toBeNull()
    expect(host!.open(session.id).record.engineSessionId).not.toBe('fake-thread')
  })
})

// 每条要起几个假 Codex 进程（会话 + 读轮次的临时进程），完整检查并发跑时会超过默认的 5 秒
describe('Codex 分叉', { timeout: 20_000 }, () => {
  it('新会话第一次发送走 thread/fork(lastTurnId)，原会话不变', async () => {
    const { session, messages, say, conversation } = setup()
    await conversation(['一', '二', '三'])
    const forked = await host!.forkSession(session.id, 'm2')
    expect(forked.text).toBe('三')
    expect(forked.record.engineSessionId ?? null).toBeNull()
    expect(forked.record.pendingFork).toEqual({ from: 'fake-thread', at: 'turn-2' })
    const from = messages().length
    await say(forked.record.id, '另一条路', 'f0')
    const sent = messages().slice(from)
    expect(sent.filter(m => m.method === 'thread/fork')).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ threadId: 'fake-thread', lastTurnId: 'turn-2', cwd: root }),
      }),
    ])
    expect(methods(sent)).not.toContain('thread/resume')
    const after = host!.open(forked.record.id).record
    expect(after.pendingFork ?? null).toBeNull()
    expect(after.engineSessionId).toMatch(/^fake-fork-/)
    expect(clientIds(after.engineSessionId!)).toEqual(['m0', 'm1', 'f0'])
    expect(clientIds('fake-thread')).toEqual(['m0', 'm1', 'm2'])
    expect(notices(forked.record.id)).toEqual([])
  })

  it('分叉到第一条：新线程，没有 pendingFork，也不调 thread/fork', async () => {
    const { session, messages, say, conversation } = setup()
    await conversation(['一', '二'])
    const forked = await host!.forkSession(session.id, 'm0')
    expect(forked.record.engineSessionId ?? null).toBeNull()
    expect(forked.record.pendingFork ?? null).toBeNull()
    const from = messages().length
    await say(forked.record.id, '新的', 'f0')
    const sent = methods(messages().slice(from))
    expect(sent).toContain('thread/start')
    expect(sent).not.toContain('thread/fork')
    expect(sent).not.toContain('thread/resume')
    expect(notices(forked.record.id)).toEqual([])
  })

  it('找不到截断点：分叉出的会话没有上下文，提示里写 Codex', async () => {
    const { session, conversation } = setup()
    await conversation(['一', '二'])
    rmSync(stateFile())
    const forked = await host!.forkSession(session.id, 'm1')
    expect(forked.record.pendingFork ?? null).toBeNull()
    expect(notices(forked.record.id)).toEqual(['无法在 Codex 记录中找到这条消息，分叉出的会话没有带上之前的上下文'])
  })

  it('还没启动的分叉会话再回退：按原线程重算 pendingFork，不会带上已移除的消息', async () => {
    const { session, messages, say, conversation } = setup()
    await conversation(['一', '二', '三'])
    const forked = await host!.forkSession(session.id, 'm2')
    await host!.rewind(forked.record.id, 'm1')
    expect(host!.open(forked.record.id).record.pendingFork).toEqual({ from: 'fake-thread', at: 'turn-1' })
    // 撤销回退：pendingFork 回到回退之前
    await host!.undoRewind(forked.record.id)
    expect(host!.open(forked.record.id).record.pendingFork).toEqual({ from: 'fake-thread', at: 'turn-2' })
    await host!.rewind(forked.record.id, 'm1')
    const from = messages().length
    await say(forked.record.id, '另一条路', 'f0')
    const sent = messages().slice(from)
    expect(sent.filter(m => m.method === 'thread/fork')).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ threadId: 'fake-thread', lastTurnId: 'turn-1' }) }),
    ])
    expect(clientIds(host!.open(forked.record.id).record.engineSessionId!)).toEqual(['m0', 'f0'])
  })

  it('还没启动的分叉会话回退到第一条：清掉 pendingFork，开新线程', async () => {
    const { session, messages, say, conversation } = setup()
    await conversation(['一', '二'])
    const forked = await host!.forkSession(session.id, 'm1')
    await host!.rewind(forked.record.id, 'm0')
    expect(host!.open(forked.record.id).record.pendingFork ?? null).toBeNull()
    const from = messages().length
    await say(forked.record.id, '新的', 'f0')
    const sent = methods(messages().slice(from))
    expect(sent).toContain('thread/start')
    expect(sent).not.toContain('thread/fork')
  })

  it('从还没启动的分叉会话再分叉：从原线程算截断点', async () => {
    const { session, conversation } = setup()
    await conversation(['一', '二', '三'])
    const first = await host!.forkSession(session.id, 'm2')
    const second = await host!.forkSession(first.record.id, 'm1')
    expect(second.record.pendingFork).toEqual({ from: 'fake-thread', at: 'turn-1' })
    expect(notices(second.record.id)).toEqual([])
    // 原线程没了：和普通分叉一样给提示
    rmSync(stateFile())
    const third = await host!.forkSession(first.record.id, 'm1')
    expect(third.record.pendingFork ?? null).toBeNull()
    expect(notices(third.record.id)).toEqual(['无法在 Codex 记录中找到这条消息，分叉出的会话没有带上之前的上下文'])
  })

  it('分叉时原线程已经没了：改开新线程并提示，清掉 pendingFork', async () => {
    const { session, say, conversation } = setup()
    await conversation(['一', '二', '三'])
    const forked = await host!.forkSession(session.id, 'm2')
    const data = threads()
    delete data['fake-thread']
    writeFileSync(stateFile(), JSON.stringify(data))
    await say(forked.record.id, '另一条路', 'f0')
    expect(notices(forked.record.id)).toEqual([
      'Could not fork the Codex thread; started a new thread (previous context was not carried over)',
    ])
    const after = host!.open(forked.record.id).record
    expect(after.pendingFork ?? null).toBeNull()
    expect(after.engineSessionId).toBeTruthy()
  })
})
