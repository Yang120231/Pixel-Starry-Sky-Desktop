import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodexAdapter, EngineHost } from '../src'
import type { EngineEvent, HostEvent } from '@pixelsky/protocol'
import { codexPermission, turnErrorDetail } from '../src/codex/session'
import { CODEX_MIN_VERSION, codexVersionStatus } from '../src/codex/discover'
import { CodexTranslator, tokenCounts } from '../src/codex/translate'
import { makeTmp, removeTmp } from './helpers/tmp'
let root: string, host: EngineHost | undefined
beforeEach(() => {
  root = makeTmp('codex-test')
})
afterEach(async () => {
  await host?.shutdown()
  host = undefined
  removeTmp(root)
})
const wait = async (fn: () => boolean): Promise<void> => {
  for (let i = 0; i < 300; i++) {
    if (fn()) return
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error('Codex test timed out')
}
function setup(idleMs = 50) {
  const log = join(root, 'rpc.jsonl'),
    events: HostEvent[] = [],
    launcher = { command: process.execPath, args: [fileURLToPath(new URL('./fakes/fake-codex.mjs', import.meta.url))] }
  const adapter = new CodexAdapter({
    launcher,
    env: { ...process.env, FAKE_CODEX_LOG: log, FAKE_CODEX_RESUME_FAIL_FILE: join(root, 'resume-fail') },
    launchOptions: () => ({ askQuestions: true, steeringValidated: true }),
  })
  host = new EngineHost({
    dataDir: join(root, 'engine'),
    adapters: { codex: adapter },
    emit: e => events.push(e),
    idleMs,
  })
  const session = host.createSession({
    projectId: host.addProject(root).id,
    engine: 'codex',
    model: 'fake-codex',
    effort: 'high',
    permissionMode: 'ask',
  })
  const messages = () =>
    readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
  return { adapter, session, log, events, messages }
}
describe('Codex app-server adapter', () => {
  it('重连与失败的报错带上附加说明、错误类型和 HTTP 状态码，供界面查看详情', async () => {
    const { session } = setup()
    await host!.send(session.id, '重连')
    await wait(
      () =>
        host!.open(session.id).state === 'idle' &&
        host!.open(session.id).items.filter(i => i.kind === 'notice').length === 3,
    )
    const notices = host!.open(session.id).items.filter(i => i.kind === 'notice')
    expect(notices.map(n => n.kind === 'notice' && n.text)).toEqual([
      'Reconnecting... 1/2',
      'Reconnecting... 2/2',
      'exceeded retry limit, last status: 502 Bad Gateway',
    ])
    expect(notices[0]).toMatchObject({
      level: 'error',
      detail: [
        'stream disconnected before completion: error sending request for url (https://api.example.test/v1/responses)',
        'type: responseStreamDisconnected',
        'HTTP status: 502',
        'will retry: yes',
      ].join('\n'),
    })
    expect(notices[2]).toMatchObject({
      detail: ['upstream connect error', 'type: responseTooManyFailedAttempts', 'HTTP status: 502'].join('\n'),
    })
  })
  it('报错详情：只有 message 时为空，字符串错误类型照样列出', () => {
    expect(turnErrorDetail({ message: 'boom' })).toBeNull()
    expect(turnErrorDetail(null)).toBeNull()
    expect(turnErrorDetail({ message: 'x', codexErrorInfo: 'usageLimitExceeded' }, false)).toBe(
      ['type: usageLimitExceeded', 'will retry: no'].join('\n'),
    )
  })
  it('动态目录、流式、用量与空闲后恢复，不重复历史', async () => {
    const { adapter, session, messages } = setup()
    expect((await adapter.info()).status).toBe('ready')
    expect((await adapter.catalog()).models?.[0].efforts).toContain('ultra')
    await host!.send(session.id, 'first')
    await wait(() => host!.open(session.id).items.some(i => i.kind === 'turn_stats'))
    expect(host!.open(session.id).items.filter(i => i.kind === 'assistant')).toHaveLength(1)
    await new Promise(r => setTimeout(r, 100))
    await host!.send(session.id, 'second')
    await wait(() => host!.open(session.id).items.filter(i => i.kind === 'turn_stats').length === 2)
    expect(messages().some(m => m.method === 'thread/resume')).toBe(true)
    expect(host!.open(session.id).items.filter(i => i.kind === 'user')).toHaveLength(2)
    expect(host!.open(session.id).usage?.contextWindow).toBe(128000)
  })
  it('审批拒绝、中断与崩溃都结束轮次并暂停队列', async () => {
    const { session } = setup()
    await host!.send(session.id, '审批')
    await wait(() => host!.open(session.id).pending.length === 1)
    host!.answer(session.id, 'approve', { type: 'deny' })
    await wait(() => host!.open(session.id).state === 'idle')
    expect(host!.open(session.id).pending).toEqual([])
    host!.resumeQueue(session.id)
    await host!.send(session.id, '慢')
    await wait(() => host!.open(session.id).flags.steerAvailable === true && host!.open(session.id).state === 'running')
    await host!.interrupt(session.id)
    expect(host!.open(session.id).queuePaused).toBe(true)
  })
  it('原生引导用对应轮次和 client ID，单条消费并显示用户内容', async () => {
    const { session, messages } = setup()
    await host!.send(session.id, '慢')
    await wait(() => host!.open(session.id).flags.steerAvailable === true)
    await new Promise(r => setTimeout(r, 40))
    const receipt = await host!.send(session.id, { text: '追加要求', clientMessageId: 'guidance-1' })
    const turnId = host!.open(session.id).turnId!
    await host!.steerQueued(session.id, receipt.queueId, turnId)
    await wait(() => host!.open(session.id).items.some(i => i.kind === 'user' && i.text === '追加要求'))
    expect(messages().find(m => m.method === 'turn/steer').params.expectedTurnId).toMatch(/^turn-/)
    expect(host!.open(session.id).items.filter(i => i.kind === 'user' && i.text === '追加要求')).toHaveLength(1)
    await host!.interrupt(session.id)
  })
  it('config.toml 引起的警告降成灰色提示、同一会话只出一次；别的警告照常每次都显示', async () => {
    const { session } = setup()
    await host!.send(session.id, '警告')
    await wait(() => host!.open(session.id).items.some(i => i.kind === 'turn_stats'))
    await host!.send(session.id, '警告')
    await wait(() => host!.open(session.id).items.filter(i => i.kind === 'turn_stats').length === 2)
    const notices = host!.open(session.id).items.flatMap(i => (i.kind === 'notice' ? [[i.level, i.text]] : []))
    expect(notices).toEqual([
      ['info', expect.stringMatching(/^Codex is ignoring 2 unrecognized configuration settings/)],
      ['info', expect.stringMatching(/^Under-development features enabled/)],
      ['warn', 'Model metadata for `fake-model` not found.'],
      ['warn', 'Model metadata for `fake-model` not found.'],
    ])
  })
  it('原生压缩走方法而非 turn/start 的普通提示', async () => {
    const { session, messages } = setup()
    await host!.send(session.id, 'hello')
    await wait(() => host!.open(session.id).state === 'idle' && host!.open(session.id).flags.compactAvailable === true)
    await host!.compactContext(session.id)
    await wait(() => messages().some(m => m.method === 'thread/compact/start'))
    expect(messages().filter(m => m.method === 'turn/start')).toHaveLength(1)
    await wait(() => host!.open(session.id).state === 'idle')
    expect(host!.open(session.id).context?.compacting).toBe(false)
  })
  it('恢复线程失败时新开线程并提示，换掉记录里的线程 id，之后的消息正常完成', async () => {
    const { session, messages } = setup()
    const failFile = join(root, 'resume-fail')
    await host!.send(session.id, 'first')
    await wait(() => host!.open(session.id).items.some(i => i.kind === 'turn_stats'))
    const oldId = host!.open(session.id).record.engineSessionId
    writeFileSync(failFile, '')
    await new Promise(r => setTimeout(r, 100))
    await host!.send(session.id, 'second')
    await wait(() => host!.open(session.id).items.filter(i => i.kind === 'turn_stats').length === 2)
    expect(messages().some(m => m.method === 'thread/resume')).toBe(true)
    expect(host!.open(session.id).items.filter(i => i.kind === 'notice')).toEqual([
      expect.objectContaining({
        kind: 'notice',
        level: 'warn',
        text: 'Could not resume the Codex thread; started a new thread (previous context was not carried over)',
      }),
    ])
    expect(host!.open(session.id).record.engineSessionId).toBeTruthy()
    expect(host!.open(session.id).record.engineSessionId).not.toBe(oldId)
    rmSync(failFile)
    await host!.send(session.id, 'third')
    await wait(() => host!.open(session.id).items.filter(i => i.kind === 'turn_stats').length === 3)
    expect(host!.open(session.id).state).toBe('idle')
  })
  it('停止后等原生结束这一轮，不会直接结束进程', async () => {
    const { session, messages, events } = setup()
    await host!.send(session.id, '缓停')
    // 等原生轮次已经开始（有了 turn id），否则停止只会在本地结束
    await wait(() => host!.open(session.id).items.some(i => i.kind === 'assistant'))
    const started = Date.now()
    await host!.interrupt(session.id)
    // 原生约 1 秒后才回 interrupted：停止要等到它结束，而不是 300 毫秒就结束进程
    expect(Date.now() - started).toBeGreaterThanOrEqual(900)
    expect(host!.open(session.id).state).toBe('idle')
    expect(messages().some(m => m.method === 'turn/interrupt')).toBe(true)
    expect(messages().filter(m => m.method === 'thread/start' || m.method === 'thread/resume')).toHaveLength(1)
    expect(
      events.some(e => e.kind === 'session' && e.event.type === 'turn_completed' && e.event.outcome === 'interrupted'),
    ).toBe(true)
  })
  it('turn/start 未返回时停止，返回后对返回的 turn id 补发 turn/interrupt', async () => {
    // 停止后会话空闲，给足时间，让晚到的 turn/start 响应能回到还活着的进程
    const { session, messages, log } = setup(3000)
    await host!.send(session.id, '延迟')
    await wait(() => existsSync(log) && messages().some(m => m.method === 'turn/start'))
    await host!.interrupt(session.id)
    expect(host!.open(session.id).state).toBe('idle')
    await wait(() => messages().some(m => m.method === 'turn/interrupt'))
    expect(messages().find(m => m.method === 'turn/interrupt').params).toEqual({
      threadId: 'fake-thread',
      turnId: 'turn-1',
    })
  })
  it('找不到的审批也发 approval_resolved，不影响真正的审批', async () => {
    const { session, events } = setup()
    await host!.send(session.id, '审批')
    await wait(() => host!.open(session.id).pending.length === 1)
    host!.answer(session.id, 'missing-request', { type: 'deny' })
    expect(
      events.some(
        e => e.kind === 'session' && e.event.type === 'approval_resolved' && e.event.requestId === 'missing-request',
      ),
    ).toBe(true)
    expect(host!.open(session.id).pending).toHaveLength(1)
    host!.answer(session.id, 'approve', { type: 'deny' })
    await wait(() => host!.open(session.id).state === 'idle')
    expect(host!.open(session.id).pending).toEqual([])
  })
  it('子智能体（别的线程）的审批照常弹卡，标题带子智能体', async () => {
    const { session, messages } = setup()
    await host!.send(session.id, '子智能体审批')
    await wait(() => host!.open(session.id).pending.length === 1)
    expect(host!.open(session.id).pending[0]).toMatchObject({
      requestId: 'approve',
      itemId: null,
      title: 'Codex subagent fake-sub command approval',
      command: 'npm test',
    })
    host!.answer(session.id, 'approve', { type: 'allow' })
    await wait(() => host!.open(session.id).state === 'idle')
    expect(messages().find(m => m.id === 'approve' && m.result)?.result).toEqual({ decision: 'accept' })
  })
  it('Codex 版本检查：读不到为 error，低于下限为 outdated，达到下限为 ready', () => {
    expect(codexVersionStatus(null)).toEqual({ status: 'error', message: 'Could not read the Codex version' })
    expect(codexVersionStatus('0.159.9')).toEqual({
      status: 'outdated',
      message: 'Codex is too old (requires 0.160.0 or later). Run npm i -g @openai/codex@latest',
    })
    expect(codexVersionStatus(CODEX_MIN_VERSION)).toEqual({ status: 'ready', message: null })
    expect(codexVersionStatus('0.161.0')).toEqual({ status: 'ready', message: null })
  })
  it('文件 diff 和完整消息更新不重复累计文字，缓存拆分不重叠', () => {
    const items: unknown[] = []
    const translator = new CodexTranslator(e => items.push(e))
    translator.item({ type: 'agentMessage', id: 'one', text: '' }, false)
    translator.delta('item/agentMessage/delta', { itemId: 'one', delta: 'hello' })
    translator.item({ type: 'agentMessage', id: 'one', text: 'hello' }, true)
    expect(translator.items.get('cx-one')).toMatchObject({ text: 'hello' })
    translator.item(
      {
        type: 'fileChange',
        id: 'file',
        changes: [{ path: 'file.ts', kind: { type: 'update' }, diff: '@@\n-old\n+new' }],
      },
      true,
    )
    expect(translator.items.get('cx-file')).toMatchObject({ changes: [{ added: 1, removed: 1 }] })
    expect(
      tokenCounts({ inputTokens: 100, cachedInputTokens: 40, cacheWriteInputTokens: 10, outputTokens: 20 }),
    ).toMatchObject({ input: 50, cacheRead: 40, cacheWrite: 10, output: 20 })
    expect(codexPermission('plan').sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: false })
    // 项目的附加文件夹和工作目录一样可写（docs/ui/multi-root-projects.md §3.3）
    expect(codexPermission('auto', '/w', ['/a', '/b']).sandboxPolicy).toMatchObject({
      writableRoots: ['/w', '/a', '/b'],
    })
  })
  it('压缩上下文：开始带压缩前大小，完成后用下一次用量补上压缩后大小', () => {
    const events: EngineEvent[] = []
    let used: number | null = 120_000
    const translator = new CodexTranslator(
      e => events.push(e),
      () => used,
    )
    translator.item({ type: 'contextCompaction', id: 'c1' }, false)
    expect(translator.items.get('cx-c1')).toMatchObject({ kind: 'compaction', status: 'running', preTokens: 120_000 })
    used = 130_000
    translator.item({ type: 'contextCompaction', id: 'c1' }, true)
    expect(translator.items.get('cx-c1')).toMatchObject({ status: 'completed', preTokens: 120_000, postTokens: null })
    expect(translator.items.get('cx-c1')).toHaveProperty('durationMs', expect.any(Number))
    translator.usage(15_000)
    translator.usage(16_000)
    expect(translator.items.get('cx-c1')).toMatchObject({ postTokens: 15_000 })
  })
})
