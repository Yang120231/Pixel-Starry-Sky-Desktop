import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodexAdapter, EngineHost } from '../src'
import type { AgentRun, EngineEvent, EngineInfo, HostEvent, ImageAttachment } from '@pixelsky/protocol'
import type { EngineAdapter, EngineSession, SessionContext } from '../src/adapter'
import { ENGINES } from '../src/registry'
import { codexPermission, turnErrorDetail, withoutOwnFeatures } from '../src/codex/session'
import { CODEX_MIN_VERSION, codexVersionStatus } from '../src/codex/discover'
import { CodexTranslator, tokenCounts } from '../src/codex/translate'
import { loadCodexRuns } from '../src/codex/runs'
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
function setup(
  idleMs = 50,
  opts: { env?: Record<string, string>; permissionMode?: 'ask' | 'plan'; askQuestions?: boolean } = {},
) {
  const log = join(root, 'rpc.jsonl'),
    argv = join(root, 'argv.jsonl'),
    events: HostEvent[] = [],
    launcher = { command: process.execPath, args: [fileURLToPath(new URL('./fakes/fake-codex.mjs', import.meta.url))] }
  const adapter = new CodexAdapter({
    launcher,
    env: {
      ...process.env,
      FAKE_CODEX_LOG: log,
      FAKE_CODEX_ARGV: argv,
      FAKE_CODEX_RESUME_FAIL_FILE: join(root, 'resume-fail'),
      ...opts.env,
    },
    launchOptions: () => ({ askQuestions: opts.askQuestions ?? true, steeringValidated: true }),
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
    permissionMode: opts.permissionMode ?? 'ask',
  })
  const messages = () =>
    readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
  const launches = (): string[][] =>
    existsSync(argv)
      ? readFileSync(argv, 'utf8')
          .trim()
          .split('\n')
          .map(line => JSON.parse(line))
      : []
  return { adapter, session, log, events, messages, launches }
}
describe('Codex app-server adapter', () => {
  it('检测时分清授权来源：ChatGPT 登录、API Key、config.toml 里自己的接口、没登录', async () => {
    const info = async (account: unknown, provider = 'openai') => {
      const { adapter } = setup(50, {
        env: { FAKE_CODEX_ACCOUNT: JSON.stringify(account), FAKE_CODEX_PROVIDER: provider },
      })
      const result = await adapter.info()
      await host?.shutdown()
      host = undefined
      return result
    }
    const chatgpt = await info({
      account: { type: 'chatgpt', email: 'a@example.com', planType: 'plus' },
      requiresOpenaiAuth: true,
    })
    expect(chatgpt).toMatchObject({
      status: 'ready',
      auth: { kind: 'login' },
      account: { email: 'a@example.com', plan: 'plus' },
    })
    expect(await info({ account: { type: 'apiKey' }, requiresOpenaiAuth: true })).toMatchObject({
      status: 'ready',
      auth: { kind: 'apiKey' },
    })
    const relay = await info({ account: null, requiresOpenaiAuth: false }, 'relay')
    expect(relay).toMatchObject({ status: 'ready', auth: { kind: 'provider', provider: 'relay' } })
    expect(relay.account).toBeUndefined()
    const none = await info({ account: null, requiresOpenaiAuth: true })
    expect(none.status).toBe('unauthenticated')
    expect(none.auth).toBeUndefined()
  })
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
  it('完全放行立即覆盖本轮不同命令、子智能体、文件和权限审批，保留问答与 MCP 表单；下一轮原生放行且可以改回', async () => {
    const { session, messages, events } = setup(3000)
    await host!.send(session.id, '连续审批')
    await wait(() => host!.open(session.id).pending.length === 1)
    expect(host!.open(session.id).pending[0].canAllowAll).toBe(true)
    host!.answer(session.id, 'approval-1', { type: 'allow_all' })
    await wait(() => host!.open(session.id).pending[0]?.requestId === 'approval-5')
    expect(host!.open(session.id).record.permissionMode).toBe('full')
    expect(host!.executionRecord(session.id)?.permissionMode).toBe('full')
    expect(messages().find(m => m.id === 'approval-2' && m.result)?.result).toEqual({ decision: 'accept' })
    expect(messages().find(m => m.id === 'approval-3' && m.result)?.result).toEqual({ decision: 'accept' })
    expect(messages().find(m => m.id === 'approval-4' && m.result)?.result).toMatchObject({
      permissions: { network: { enabled: true } },
    })
    expect(
      events.flatMap(e =>
        e.kind === 'session' && e.event.type === 'approval_request' ? [e.event.request.requestId] : [],
      ),
    ).toEqual(['approval-1', 'approval-5'])
    host!.answer(session.id, 'approval-5', { type: 'answer', answers: { 'Choose a name': 'Pixel' } })
    await wait(() => host!.open(session.id).pending[0]?.requestId === 'approval-6')
    expect(host!.open(session.id).pending[0].canAllowAll).toBe(false)
    host!.answer(session.id, 'approval-6', { type: 'form', content: { name: 'Pixel' } })
    await wait(() => host!.open(session.id).state === 'idle')

    await host!.send(session.id, '第二轮')
    await wait(() => host!.open(session.id).state === 'idle')
    expect(
      messages()
        .filter(m => m.method === 'turn/start')
        .at(-1).params,
    ).toMatchObject({
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' },
    })
    const other = host!.createSession({ projectId: session.projectId, engine: 'codex' })
    expect(other.permissionMode).toBe('edits')

    await host!.update(session.id, { permissionMode: 'edits' })
    await host!.send(session.id, '审批')
    await wait(() => host!.open(session.id).pending.length === 1)
    expect(
      messages()
        .filter(m => m.method === 'turn/start')
        .at(-1).params.approvalPolicy,
    ).toBe('on-request')
    host!.answer(session.id, 'approve', { type: 'deny' })
    await wait(() => host!.open(session.id).state === 'idle')
  })
  it.each(['allow', 'allow_always'] as const)('%s 保留原来的审批范围，不切换为完全放行', async type => {
    const { session } = setup()
    await host!.send(session.id, '连续审批')
    await wait(() => host!.open(session.id).pending.length === 1)
    host!.answer(session.id, 'approval-1', type === 'allow' ? { type } : { type, scope: 'session' })
    await wait(() => host!.open(session.id).pending[0]?.requestId === 'approval-2')
    expect(host!.open(session.id).record.permissionMode).toBe('ask')
    host!.answer(session.id, 'approval-2', { type: 'deny' })
    await wait(() => host!.open(session.id).state === 'idle')
  })
  it('原生请求不支持允许时不能通过完全放行绕过，也不会修改权限', async () => {
    const { session } = setup(50, { env: { FAKE_CODEX_DECISIONS: '["decline"]' } })
    await host!.send(session.id, '审批')
    await wait(() => host!.open(session.id).pending.length === 1)
    expect(host!.open(session.id).pending[0].canAllowAll).toBe(false)
    expect(() => host!.answer(session.id, 'approve', { type: 'allow_all' })).toThrow('cannot enable full access')
    expect(host!.open(session.id).record.permissionMode).toBe('ask')
    expect(host!.open(session.id).pending).toHaveLength(1)
    host!.answer(session.id, 'approve', { type: 'deny' })
    await wait(() => host!.open(session.id).state === 'idle')
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
  it('config.toml 引起的警告不进对话、记在引擎信息上（只广播一次，重新检测清掉）；别的警告照常每次都显示', async () => {
    const { session, events } = setup()
    await host!.send(session.id, '警告')
    await wait(() => host!.open(session.id).items.some(i => i.kind === 'turn_stats'))
    await host!.send(session.id, '警告')
    await wait(() => host!.open(session.id).items.filter(i => i.kind === 'turn_stats').length === 2)
    const notices = host!.open(session.id).items.flatMap(i => (i.kind === 'notice' ? [[i.level, i.text]] : []))
    expect(notices).toEqual([
      ['warn', 'Model metadata for `fake-model` not found.'],
      ['warn', 'Model metadata for `fake-model` not found.'],
    ])
    const codex = async () => (await host!.engines()).find(e => e.id === 'codex')!
    expect((await codex()).configWarnings).toEqual([
      expect.stringMatching(/^Codex is ignoring 2 unrecognized configuration settings/),
      expect.stringMatching(/^Under-development features enabled/),
    ])
    // 第二轮同样的警告不再广播
    const broadcasts = events.filter(e => e.kind === 'engines' && e.engines.some(x => x.configWarnings))
    expect(broadcasts).toHaveLength(2)
    // 登录 / 装更新 / 改启动设置引起的重新检测不动警告；用户自己点「重新检测」才清掉
    await host!.engines(true)
    expect((await codex()).configWarnings).toHaveLength(2)
    await host!.engines(true, true)
    expect((await codex()).configWarnings).toBeUndefined()
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
  it('新版子智能体：派出出一张卡并进追踪，发消息不出卡，跑完跨轮也能更新，子线程算工具次数和 token', () => {
    const events: EngineEvent[] = [],
      agents = new Map<string, AgentRun>()
    const first = new CodexTranslator(e => events.push(e), undefined, agents)
    const spawn = {
      type: 'subAgentActivity',
      id: 'call_spawn',
      kind: 'started',
      agentThreadId: 'child-1',
      agentPath: '/root/pattern_api',
      model: 'gpt-x',
    }
    first.item(spawn, false)
    first.item(spawn, true)
    expect(first.items.get('cx-call_spawn')).toMatchObject({
      kind: 'tool',
      tool: 'task',
      title: 'pattern_api',
      status: 'completed',
    })
    expect(agents.get('child-1')).toMatchObject({
      label: 'pattern_api',
      model: 'gpt-x',
      state: 'running',
      toolUseId: 'cx-call_spawn',
    })
    first.item({ type: 'subAgentActivity', id: 'call_msg', kind: 'interacted', agentThreadId: 'child-1' }, true)
    expect(first.items.has('cx-call_msg')).toBe(false)
    first.child('child-1', 'item/completed', { item: { type: 'commandExecution' } })
    first.child('child-1', 'item/completed', { item: { type: 'agentMessage' } })
    first.child('child-1', 'thread/tokenUsage/updated', { tokenUsage: { total: { totalTokens: 1234 } } })
    expect(agents.get('child-1')).toMatchObject({ toolCalls: 1, tokens: 1234 })
    // 下一轮换了翻译器，跑完照样记到原来的追踪上
    const next = new CodexTranslator(e => events.push(e), undefined, agents)
    next.item(
      {
        type: 'subAgentActivity',
        id: 'subagent-completed-child-1',
        kind: 'completed',
        agentThreadId: 'child-1',
        agentPath: '/root/pattern_api',
      },
      true,
    )
    expect(next.items.size).toBe(0)
    expect(agents.get('child-1')).toMatchObject({
      state: 'completed',
      model: 'gpt-x',
      toolUseId: 'cx-call_spawn',
      toolCalls: 1,
    })
    const runs = events.filter(e => e.type === 'runs').at(-1)
    expect(runs).toMatchObject({ runs: { agents: [{ id: 'child-1', state: 'completed' }] } })
  })
  it('重新打开会话：从线程的各段 rollout 还原子智能体追踪', () => {
    const thread = '01a14092-744d-7183-a67e-8a03c58f3578',
      at = parseInt(thread.replace(/-/g, '').slice(0, 12), 16)
    const dayDir = (time: number) => {
      const date = new Date(time),
        dir = join(
          root,
          'sessions',
          String(date.getFullYear()),
          String(date.getMonth() + 1).padStart(2, '0'),
          String(date.getDate()).padStart(2, '0'),
        )
      mkdirSync(dir, { recursive: true })
      return dir
    }
    const event = (item: object, started: number) =>
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'item_completed', thread_id: thread, item, started_at_ms: started },
      })
    const activity = (id: string, kind: string, model: string | null) => ({
      type: 'SubAgentActivity',
      model,
      id,
      kind,
      agent_thread_id: 'child-1',
      agent_path: '/root/pattern_api',
    })
    writeFileSync(
      join(dayDir(at), `rollout-2026-10-16T01-18-22-${thread}.jsonl`),
      [
        JSON.stringify({ type: 'session_meta', payload: { id: thread } }),
        event(activity('call_spawn', 'started', 'gpt-x'), at + 1000),
      ].join('\n'),
    )
    // 隔几天接着跑：另起一段，放在那天的目录
    writeFileSync(
      join(
        dayDir(at + 3 * 86_400_000),
        `rollout-2026-10-19T09-00-00-${thread}_01a14097-8eb8-7691-873b-2c6ad0d11d32.jsonl`,
      ),
      [event(activity('subagent-completed-child-1', 'completed', null), at + 61_000), ''].join('\n'),
    )
    expect(loadCodexRuns(root, thread).agents).toEqual([
      expect.objectContaining({
        id: 'child-1',
        label: 'pattern_api',
        model: 'gpt-x',
        state: 'completed',
        startedAt: at + 1000,
        durationMs: 60_000,
        toolUseId: 'cx-call_spawn',
      }),
    ])
    expect(loadCodexRuns(root, 'not-a-uuid').agents).toEqual([])
  })
  it('重新打开会话：只派出没跑完的子智能体标成已中断，跑完的保持完成', () => {
    const thread = '01a14092-744d-7183-a67e-8a03c58f3579',
      at = parseInt(thread.replace(/-/g, '').slice(0, 12), 16),
      date = new Date(at),
      dir = join(
        root,
        'sessions',
        String(date.getFullYear()),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      )
    mkdirSync(dir, { recursive: true })
    const event = (id: string, kind: string, child: string, started: number) =>
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          thread_id: thread,
          item: { type: 'SubAgentActivity', id, kind, agent_thread_id: child, agent_path: '/root/' + child },
          started_at_ms: started,
        },
      })
    writeFileSync(
      join(dir, `rollout-2026-10-16T01-18-22-${thread}.jsonl`),
      [
        event('s1', 'started', 'child-a', at + 1000),
        event('s2', 'started', 'child-b', at + 2000),
        event('c2', 'completed', 'child-b', at + 5000),
      ].join('\n'),
    )
    const agents = loadCodexRuns(root, thread).agents
    expect(agents.find(a => a.id === 'child-a')).toMatchObject({ state: 'interrupted', toolUseId: 'cx-s1' })
    expect(agents.find(a => a.id === 'child-b')).toMatchObject({ state: 'completed', durationMs: 3000 })
  })
  it('collab 调用只有派出（spawnAgent）出派发卡并认领子智能体；等待 / 关闭沿用派出时的卡片，状态跟着子智能体', () => {
    const agents = new Map<string, AgentRun>(),
      translator = new CodexTranslator(() => {}, undefined, agents),
      collab = (id: string, tool: string, status: string, state: string) => ({
        type: 'collabAgentToolCall',
        id,
        tool,
        status,
        prompt: tool === 'spawnAgent' ? '干活' : undefined,
        receiverThreadIds: ['child-1'],
        agentsStates: { 'child-1': { status: state, message: null } },
      })
    translator.item(collab('spawn', 'spawnAgent', 'completed', 'pendingInit'), true)
    translator.item(collab('wait', 'wait', 'completed', 'running'), true)
    translator.item(collab('close', 'closeAgent', 'completed', 'shutdown'), true)
    expect(translator.items.get('cx-spawn')).toMatchObject({ name: 'spawn_agent' })
    expect(translator.items.get('cx-wait')).toMatchObject({ name: 'collabAgentToolCall' })
    expect(translator.items.get('cx-close')).toMatchObject({ name: 'collabAgentToolCall' })
    expect(agents.get('child-1')).toMatchObject({ state: 'shutdown', toolUseId: 'cx-spawn', prompt: '干活' })
  })
  it('重新打开会话：只派出没跑完的子智能体标成已中断，跑完的保持完成', () => {
    const thread = '01a14092-744d-7183-a67e-8a03c58f3579',
      at = parseInt(thread.replace(/-/g, '').slice(0, 12), 16),
      date = new Date(at),
      dir = join(
        root,
        'sessions',
        String(date.getFullYear()),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      )
    mkdirSync(dir, { recursive: true })
    const event = (id: string, kind: string, child: string, started: number) =>
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          thread_id: thread,
          item: { type: 'SubAgentActivity', id, kind, agent_thread_id: child, agent_path: '/root/' + child },
          started_at_ms: started,
        },
      })
    writeFileSync(
      join(dir, `rollout-2026-10-16T01-18-22-${thread}.jsonl`),
      [
        event('s1', 'started', 'child-a', at + 1000),
        event('s2', 'started', 'child-b', at + 2000),
        event('c2', 'completed', 'child-b', at + 5000),
      ].join('\n'),
    )
    const agents = loadCodexRuns(root, thread).agents
    expect(agents.find(a => a.id === 'child-a')).toMatchObject({ state: 'interrupted', toolUseId: 'cx-s1' })
    expect(agents.find(a => a.id === 'child-b')).toMatchObject({ state: 'completed', durationMs: 3000 })
  })
  it('collab 调用只有派出（spawnAgent）认领子智能体；等待 / 关闭沿用派出时的卡片，状态跟着子智能体', () => {
    const agents = new Map<string, AgentRun>(),
      translator = new CodexTranslator(() => {}, undefined, agents),
      collab = (id: string, tool: string, status: string, state: string) => ({
        type: 'collabAgentToolCall',
        id,
        tool,
        status,
        prompt: tool === 'spawnAgent' ? '干活' : undefined,
        receiverThreadIds: ['child-1'],
        agentsStates: { 'child-1': { status: state, message: null } },
      })
    translator.item(collab('spawn', 'spawnAgent', 'completed', 'pendingInit'), true)
    translator.item(collab('wait', 'wait', 'completed', 'running'), true)
    translator.item(collab('close', 'closeAgent', 'completed', 'shutdown'), true)
    expect(translator.items.get('cx-spawn')).toMatchObject({ name: 'spawn_agent' })
    expect(translator.items.get('cx-wait')).toMatchObject({ name: 'collabAgentToolCall' })
    expect(translator.items.get('cx-close')).toMatchObject({ name: 'collabAgentToolCall' })
    expect(agents.get('child-1')).toMatchObject({ state: 'shutdown', toolUseId: 'cx-spawn', prompt: '干活' })
  })
  it('计划模式带 Codex 原生计划协作模式，模型提问弹问题卡；切回别的权限时带一次 default', async () => {
    const { session, messages } = setup(50, { permissionMode: 'plan' })
    await host!.send(session.id, '提问')
    await wait(() => host!.open(session.id).pending.length === 1)
    const start = () => messages().filter(m => m.method === 'turn/start')
    // 会话进程声明实验接口（第一条 initialize 是检测引擎时的探测进程）
    expect(
      messages()
        .filter(m => m.method === 'initialize')
        .at(-1)?.params.capabilities,
    ).toEqual({ experimentalApi: true })
    expect(start()[0].params).toMatchObject({
      approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'readOnly' },
      collaborationMode: {
        mode: 'plan',
        settings: { model: 'fake-codex', reasoning_effort: 'high', developer_instructions: null },
      },
    })
    expect(host!.open(session.id).pending[0]).toMatchObject({
      requestId: 'ask',
      kind: 'question',
      questions: [
        {
          id: 'scope',
          question: '先做哪一批？',
          allowOther: true,
          options: [{ label: '只做收尾（推荐）' }, { label: '先补测试' }],
        },
      ],
    })
    host!.answer(session.id, 'ask', { type: 'answer', answers: { '先做哪一批？': '只做收尾（推荐）' } })
    await wait(() => host!.open(session.id).state === 'idle')
    expect(messages().find(m => m.id === 'ask' && m.result)?.result).toEqual({
      answers: { scope: { answers: ['只做收尾（推荐）'] } },
    })
    await host!.update(session.id, { permissionMode: 'edits' })
    await host!.send(session.id, '第二轮')
    await wait(() => host!.open(session.id).state === 'idle' && start().length === 2)
    await host!.send(session.id, '第三轮')
    await wait(() => host!.open(session.id).state === 'idle' && start().length === 3)
    expect(start()[1].params.collaborationMode).toMatchObject({ mode: 'default', settings: { model: 'fake-codex' } })
    expect(start()[2].params.collaborationMode).toBeUndefined()
  })
  it('允许提问时打开 Default 模式提问：启动带开关，第一轮带一次 default 拿提问指令，非计划模式也弹问题卡', async () => {
    const { session, messages, launches } = setup()
    await host!.send(session.id, '提问')
    await wait(() => host!.open(session.id).pending.length === 1)
    expect(launches().at(-1)).toEqual(expect.arrayContaining(['-c', 'features.default_mode_request_user_input=true']))
    const start = () => messages().filter(m => m.method === 'turn/start')
    expect(start()[0].params.collaborationMode).toEqual({
      mode: 'default',
      settings: { model: 'fake-codex', reasoning_effort: 'high', developer_instructions: null },
    })
    expect(host!.open(session.id).pending[0]).toMatchObject({ kind: 'question', questions: [{ id: 'scope' }] })
    host!.answer(session.id, 'ask', { type: 'answer', answers: { '先做哪一批？': '先补测试' } })
    await wait(() => host!.open(session.id).state === 'idle')
    await host!.send(session.id, '第二轮')
    await wait(() => host!.open(session.id).state === 'idle' && start().length === 2)
    expect(start()[1].params.collaborationMode).toBeUndefined()
  })
  it('不允许提问时不开 Default 模式提问，也不带协作模式', async () => {
    const { session, messages, launches } = setup(50, { askQuestions: false })
    await host!.send(session.id, '提问')
    await wait(() => host!.open(session.id).state === 'idle')
    expect(host!.open(session.id).pending).toHaveLength(0)
    expect(launches().at(-1)!.join(' ')).not.toContain('default_mode_request_user_input')
    expect(messages().find(m => m.method === 'turn/start')?.params.collaborationMode).toBeUndefined()
  })
  it('开发中功能警告里去掉像素星空自己打开的 Default 模式提问；只剩它时不报', () => {
    const tail = ' Under-development features are incomplete and may behave unpredictably.'
    expect(withoutOwnFeatures(`Under-development features enabled: default_mode_request_user_input.${tail}`)).toBe(null)
    expect(
      withoutOwnFeatures(`Under-development features enabled: memories, default_mode_request_user_input.${tail}`),
    ).toBe(`Under-development features enabled: memories.${tail}`)
    expect(withoutOwnFeatures('Model metadata for `x` not found.')).toBe('Model metadata for `x` not found.')
  })
  it('Fast：自己的 openai 登录且模型有 priority 档位时可开，每轮写明档位；换到没有档位的模型就关掉并说明原因', async () => {
    const { session, messages } = setup(50, { env: { FAKE_CODEX_PROVIDER: 'openai' } })
    await host!.update(session.id, { fast: true })
    await host!.send(session.id, '快')
    await wait(() => host!.open(session.id).state === 'idle')
    expect(host!.open(session.id).flags).toMatchObject({ fastAvailable: true, fastState: 'on', fastBlocked: null })
    const start = () => messages().filter(m => m.method === 'turn/start')
    expect(start()[0].params.serviceTier).toBe('priority')
    expect(start()[0].params.collaborationMode).toMatchObject({ mode: 'default' })
    await host!.update(session.id, { fast: false })
    await host!.send(session.id, '慢一点')
    await wait(() => host!.open(session.id).state === 'idle' && start().length === 2)
    expect(start()[1].params.serviceTier).toBe('default')
    await host!.update(session.id, { fast: true, model: 'fake-plain' })
    await wait(() => host!.open(session.id).flags.fastBlocked === 'model_not_allowed')
    expect(host!.open(session.id).flags.fastAvailable).toBe(false)
    expect(host!.open(session.id).record.fast).toBe(false)
  })
  it('Fast：provider 不是 openai（自定义 / 平台线路）时开不了，不带 serviceTier', async () => {
    const { session, messages } = setup()
    await host!.update(session.id, { fast: true })
    await host!.send(session.id, '快')
    await wait(() => host!.open(session.id).state === 'idle')
    expect(host!.open(session.id).flags).toMatchObject({ fastAvailable: false, fastBlocked: 'codex_gateway' })
    expect(host!.open(session.id).record.fast).toBe(false)
    expect(messages().find(m => m.method === 'turn/start')?.params.serviceTier).toBeUndefined()
  })
})

/** 跨引擎接力里的另一个引擎：收到消息就被打断，没有回复 */
class InterruptedClaude implements EngineAdapter {
  async info(): Promise<EngineInfo> {
    return { ...ENGINES.claude, status: 'ready', version: 'stub', path: 'stub', message: null }
  }
  createSession(ctx: SessionContext): EngineSession {
    return {
      send(_text, turnId) {
        ctx.emit({ type: 'turn_completed', turnId, outcome: 'interrupted', error: null })
      },
      async interrupt() {},
      answer() {},
      async update() {},
      async close() {},
    }
  }
}

describe('Codex 接手带图片的聊天', () => {
  const png = (name: string): ImageAttachment => ({
    id: name.replace(/\W/g, '-'),
    name,
    mediaType: 'image/png',
    bytes: 16,
    width: 1,
    height: 1,
    dataBase64: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8, name.length)]).toString(
      'base64',
    ),
  })
  const url = (image: ImageAttachment) => `data:image/png;base64,${image.dataBase64}`
  const ASKED = '这个地方显示的内容不对'
  /** 引擎发的警告提示 */
  const notices = (id: string) =>
    host!.open(id).items.flatMap(i => (i.kind === 'notice' && i.level === 'warn' ? [i.text] : []))
  type Rpc = { method?: string; params?: { items?: { role: string; content: Record<string, unknown>[] }[] } }

  /** claude 先收到一条带图的消息，被打断没有回复；再换成 Codex 发下一条 */
  async function handoff(model: string, env: Record<string, string>, next: ImageAttachment[] | undefined) {
    const log = join(root, 'rpc.jsonl')
    const adapter = new CodexAdapter({
      launcher: {
        command: process.execPath,
        args: [fileURLToPath(new URL('./fakes/fake-codex.mjs', import.meta.url))],
      },
      env: { ...process.env, FAKE_CODEX_LOG: log, ...env },
      launchOptions: () => ({ askQuestions: true, steeringValidated: true }),
    })
    host = new EngineHost({
      dataDir: join(root, 'engine'),
      adapters: { claude: new InterruptedClaude(), codex: adapter },
      emit: () => {},
      idleMs: 60_000,
    })
    const session = host.createSession({
      projectId: host.addProject(root).id,
      engine: 'claude',
      model: 'm',
      effort: 'high',
      permissionMode: 'ask',
    })
    const idle = () => host!.open(session.id).state === 'idle' && host!.open(session.id).queue.length === 0
    const old = png('old.png')
    await host.send(session.id, { text: ASKED, clientMessageId: 'first', attachments: [old] })
    await wait(() => host!.open(session.id).items.some(i => i.kind === 'user') && idle())
    await host.update(session.id, { engine: 'codex', model })
    await host.send(session.id, { text: '怎么样', clientMessageId: 'second', ...(next ? { attachments: next } : {}) })
    await wait(() => host!.open(session.id).items.some(i => i.kind === 'turn_stats') && idle())
    const messages = (): Rpc[] =>
      readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
    return { old, session, messages }
  }

  it('注入线程的用户消息带 input_image，回复占位仍在，开轮的输入只有这条消息自己', async () => {
    const { old, messages } = await handoff('fake-codex', {}, undefined)
    const inject = messages().find(m => m.method === 'thread/inject_items')!
    expect(inject.params!.items).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: `${ASKED}（附：old.png）` },
          { type: 'input_image', image_url: url(old) },
        ],
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '（这一轮没有回复，可能被中断了）' }],
      },
    ])
    const start = messages().find(m => m.method === 'turn/start') as { params: { input: unknown[] } }
    expect(start.params.input).toEqual([{ type: 'text', text: '怎么样', text_elements: [] }])
  })

  it('模型不能看图：只注入文字并写明图片没带上，不报错', async () => {
    const { session, messages } = await handoff('fake-plain', {}, undefined)
    const inject = messages().find(m => m.method === 'thread/inject_items')!
    expect(inject.params!.items![0].content).toEqual([
      { type: 'input_text', text: `${ASKED}（附：old.png）（上面这些图片没有带上：当前模型不能看图）` },
    ])
    expect(host!.open(session.id).items.some(i => i.kind === 'notice' && i.level === 'error')).toBe(false)
    // host 的提示说带了图片，这里告诉用户实际没带
    expect(notices(session.id)).toEqual([
      "The current model can't view images, so 1 earlier image(s) were not actually passed along",
    ])
  })

  it('注入失败退回文字交接：更早消息的图片排在消息自己的图片前面一起发', async () => {
    const own = png('own.png')
    const { old, messages } = await handoff('fake-codex', { FAKE_CODEX_INJECT_FAIL: '1' }, [own])
    const start = messages().find(m => m.method === 'turn/start') as {
      params: { input: { type: string; text?: string; url?: string }[] }
    }
    const input = start.params.input
    expect(input.map(i => i.type)).toEqual(['text', 'image', 'image'])
    expect(input[0].text).toContain(`下面第 1 张图是之前「${ASKED}」那条消息附的 old.png`)
    expect(input[0].text!.endsWith('\n\n怎么样')).toBe(true)
    expect(input.slice(1).map(i => i.url)).toEqual([url(old), url(own)])
  })

  it('注入失败且模型不能看图：只发文字交接，不带图片也不报错', async () => {
    const { session, messages } = await handoff('fake-plain', { FAKE_CODEX_INJECT_FAIL: '1' }, undefined)
    const start = messages().find(m => m.method === 'turn/start') as { params: { input: { type: string }[] } }
    expect(start.params.input.map(i => i.type)).toEqual(['text'])
    expect(notices(session.id).filter(t => t.includes('view images'))).toEqual([
      "The current model can't view images, so 1 earlier image(s) were not actually passed along",
    ])
  })
})
