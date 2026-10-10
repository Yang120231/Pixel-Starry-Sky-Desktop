import { describe, expect, it } from 'vitest'
import { contextDiagnostic, type ContextWindow, type EngineEvent } from '@pixelsky/protocol'
import { ContextReader } from '../src/claude/context'

const fixture = () => ({
  model: 'main',
  total_tokens: 60000,
  raw_max_tokens: 200000,
  categories: [
    { name: 'System prompt', tokens: 10000, kind: 'used' },
    { name: 'Messages', tokens: 50000, kind: 'used' },
    { name: 'Autocompact buffer', tokens: 30000, kind: 'buffer' },
    { name: 'Free space', tokens: 110000, kind: 'free' },
  ],
  mcp_tools: [{ name: 'browser', tokens: 400 }],
  memory_files: [],
  agents: [],
  skills: [{ name: 'project', tokens: 300, source: 'workspace' }],
})
function reader() {
  const events: EngineEvent[] = [],
    instance = new ContextReader(e => events.push(e))
  const last = (): ContextWindow => {
    const event = events.filter(e => e.type === 'context').at(-1)
    if (event?.type !== 'context' || !event.context) throw Error('no context')
    return event.context
  }
  return { instance, events, last }
}
describe('上下文来自同一主请求', () => {
  it('start 输入与仅含输出的 delta 合并，输出不加进上下文占用', () => {
    const r = reader()
    r.instance.handle({
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: {
          id: 'm',
          model: 'main',
          usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 20 },
        },
      },
    })
    r.instance.handle({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 500 } } })
    expect(r.last()).toMatchObject({
      model: 'main',
      used: 120,
      input: 10,
      cacheRead: 90,
      cacheWrite: 20,
      output: 500,
      window: null,
    })
  })
  it('缺失或非法计数不补零，明确零与零占用可用', () => {
    const r = reader()
    r.instance.handle({
      type: 'assistant',
      message: { id: 'm', model: 'main', usage: { input_tokens: 0, cache_read_input_tokens: 0 } },
    })
    expect(r.last().used).toBeNull()
    expect(r.last().cacheWrite).toBeNull()
    r.instance.handle({
      type: 'assistant',
      message: { id: 'm', model: 'main', usage: { cache_creation_input_tokens: 0 } },
    })
    expect(r.last().used).toBe(0)
    r.instance.handle({
      type: 'assistant',
      message: { id: 'm', model: 'main', usage: { cache_read_input_tokens: -1 } },
    })
    expect(r.last().used).toBeNull()
  })
  it('容量按最新主模型匹配，累计 result 不替换请求计数', () => {
    const r = reader()
    r.instance.handle({
      type: 'assistant',
      message: {
        id: 'm',
        model: 'main',
        usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    })
    r.instance.handle({
      type: 'result',
      usage: { input_tokens: 900000 },
      modelUsage: { main: { contextWindow: 200000 }, summary: { contextWindow: 1000000 } },
    })
    expect(r.last()).toMatchObject({ used: 100, window: 200000 })
  })
  it('首轮 result 之前用价格表的上下文长度兜底，result 报的容量优先，带 [1m] 后缀的键也能对上', () => {
    const r = reader()
    const assistant = (id: string) => ({
      type: 'assistant',
      message: {
        id,
        model: 'claude-opus-5-5',
        usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    })
    r.instance.handle(assistant('a'))
    expect(r.last().window).toBe(1000000)
    r.instance.handle({ type: 'result', modelUsage: { 'claude-opus-5-5[1m]': { contextWindow: 400000 } } })
    expect(r.last().window).toBe(400000)
    r.instance.handle(assistant('b'))
    expect(r.last().window).toBe(400000)
  })
  it('子智能体、旧消息回放与较晚到达的旧 assistant 不替换最新请求', () => {
    const r = reader()
    const assistant = (id: string, input: number) => ({
      type: 'assistant',
      message: {
        id,
        model: 'main',
        usage: { input_tokens: input, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    })
    r.instance.handle(assistant('a', 10))
    r.instance.handle(assistant('b', 20))
    r.instance.handle(assistant('a', 90))
    r.instance.handle({ ...assistant('sub', 1000), parent_tool_use_id: 'p' })
    r.instance.handle({ ...assistant('old', 500), isReplay: true })
    expect(r.last().used).toBe(20)
  })
  it('结构化诊断保留分类与细项；新请求、压缩和重启使旧诊断过期', () => {
    const r = reader()
    expect(r.instance.diagnostic(fixture())).not.toBeNull()
    expect(r.last()).toMatchObject({ used: 60000, window: 200000, source: 'diagnostic', diagnosticStale: false })
    r.instance.handle({
      type: 'assistant',
      message: {
        id: 'next',
        model: 'main',
        usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    })
    expect(r.last()).toMatchObject({ source: 'request', used: 100, diagnosticStale: true })
    r.instance.handle({ type: 'system', subtype: 'status', status: 'compacting' })
    expect(r.last()).toMatchObject({ stale: true, compacting: true })
    r.instance.handle({ type: 'system', subtype: 'compact_boundary' })
    expect(r.last()).toMatchObject({ stale: true, compacting: false })
    r.instance.reset()
    expect(r.last().stale).toBe(true)
  })
  it('get_context_usage 的驼峰形状：延迟加载分类、记忆文件路径、MCP 服务器、skills 对象都能读出', () => {
    const d = contextDiagnostic({
      model: 'claude-opus-5-5',
      totalTokens: 21252,
      maxTokens: 1000000,
      rawMaxTokens: 1000000,
      categories: [
        { name: 'System prompt', tokens: 2305, kind: 'used' },
        { name: 'System tools (deferred)', tokens: 17968, kind: 'deferred', isDeferred: true },
        { name: 'Free space', tokens: 945748, kind: 'free' },
      ],
      memoryFiles: [{ path: 'D:\\PixelSky\\CLAUDE.md', type: 'Project', tokens: 24 }],
      mcpTools: [{ name: 'mcp__browser__open', serverName: 'browser', tokens: 400, isLoaded: true }],
      agents: [{ agentType: 'reviewer', source: 'projectSettings', tokens: 80 }],
      skills: {
        totalSkills: 1,
        includedSkills: 1,
        tokens: 20,
        skillFrontmatter: [{ name: 'run', source: 'built-in', tokens: 20 }],
      },
    })
    expect(d).toMatchObject({
      used: 21252,
      window: 1000000,
      memory: [{ name: 'D:\\PixelSky\\CLAUDE.md', source: 'Project', tokens: 24 }],
      tools: [{ name: 'mcp__browser__open', source: 'browser' }],
      agents: [{ name: 'reviewer', source: 'projectSettings' }],
      skills: [{ name: 'run', source: 'built-in' }],
    })
    expect(d?.categories[1]).toMatchObject({ kind: 'deferred' })
    const r = reader()
    expect(r.instance.diagnostic({ ...fixture(), skills: [] }, 'summary')).toMatchObject({ detail: 'summary' })
    expect(r.last()).toMatchObject({ used: 60000, source: 'diagnostic' })
    r.instance.handle({
      type: 'assistant',
      message: {
        id: 'req',
        model: 'main',
        usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    })
    r.instance.diagnostic(fixture(), 'summary')
    expect(r.last()).toMatchObject({
      used: 100,
      source: 'request',
      diagnosticStale: false,
      diagnostic: { used: 60000 },
    })
    r.instance.diagnostic(fixture(), 'full')
    expect(r.last()).toMatchObject({ used: 60000, source: 'diagnostic' })
    r.instance.handle({ type: 'system', subtype: 'status', status: 'compacting' })
    expect(r.instance.diagnostic(fixture(), 'summary')).not.toBeNull()
    expect(r.last()).toMatchObject({ compacting: true, diagnosticStale: true })
  })
  it('拒绝无容量或坏分类，忽略坏明细，不猜测文本诊断', () => {
    expect(contextDiagnostic({ ...fixture(), raw_max_tokens: 0 })).toBeNull()
    expect(contextDiagnostic({ ...fixture(), categories: [{ name: 'x', kind: 'used', tokens: NaN }] })).toBeNull()
    expect(contextDiagnostic('Context Usage 30%')).toBeNull()
    expect(contextDiagnostic(fixture(), 42)).toMatchObject({
      observedAt: 42,
      skills: [{ name: 'project', tokens: 300 }],
    })
  })
})
