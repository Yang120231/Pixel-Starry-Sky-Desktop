import { describe, expect, it } from 'vitest'
import { INFERRED_ENV, enrichModel, findBuiltin, inferredOf } from '../src/extensions/builtin-models.ts'
import { PROVIDERS_ENV, gatewayExtension, gatewayProviders } from '../src/extensions/gateway.ts'

// 和 Pi 1.3.0 内置表里的参数一样（节选）
const ALL = [
  {
    provider: 'anthropic',
    id: 'claude-opus-4-7',
    api: 'anthropic-messages',
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    reasoning: true,
    input: ['text', 'image'],
    thinkingLevelMap: { xhigh: 'xhigh', max: 'max' },
  },
  {
    provider: 'anthropic',
    id: 'claude-haiku-4-5',
    api: 'anthropic-messages',
    contextWindow: 200_000,
    maxTokens: 64_000,
  },
  { provider: 'openrouter', id: 'claude-haiku-4-5', api: 'openai-completions', contextWindow: 1, maxTokens: 1 },
  {
    provider: 'openai-codex',
    id: 'gpt-5.5',
    api: 'openai-codex-responses',
    contextWindow: 272_000,
    maxTokens: 128_000,
    thinkingLevelMap: { minimal: 'low' },
  },
  {
    provider: 'openai',
    id: 'gpt-5.5',
    api: 'openai-responses',
    contextWindow: 272_000,
    maxTokens: 128_000,
    thinkingLevelMap: { xhigh: 'xhigh', max: null },
  },
  {
    provider: 'deepseek',
    id: 'deepseek-flash',
    api: 'openai-completions',
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    input: ['text', 'image'],
  },
  { provider: 'deepseek', id: 'deepseek-v4-pro', api: 'openai-completions', contextWindow: 1_000_000, input: ['text'] },
]

describe('findBuiltin', () => {
  it('原名、带日期后缀、带 [1m] 都对得上；同名的只在官方厂商目录里找，协议一样的优先', () => {
    expect(findBuiltin('claude-opus-4-7', 'anthropic-messages', ALL)?.maxTokens).toBe(128_000)
    expect(findBuiltin('claude-haiku-4-5-20251001', 'anthropic-messages', ALL)?.provider).toBe('anthropic')
    expect(findBuiltin('claude-opus-4-7[1m]', 'anthropic-messages', ALL)?.id).toBe('claude-opus-4-7')
    expect(findBuiltin('gpt-5.5', 'openai-responses', ALL)?.provider).toBe('openai')
  })

  it('找不到原名时按名字的段匹配同系列的，光有系列名不算', () => {
    expect(findBuiltin('deepseek-v4.1-flash', 'anthropic-messages', ALL)?.id).toBe('deepseek-flash')
    expect(findBuiltin('deepseek-v4-pro-max', 'anthropic-messages', ALL)?.id).toBe('deepseek-v4-pro')
    expect(findBuiltin('deepseek-chat', 'anthropic-messages', ALL)).toBeUndefined()
    expect(findBuiltin('kimi-k2', 'anthropic-messages', ALL)).toBeUndefined()
  })
})

describe('enrichModel', () => {
  it('没写的、猜的用内置的；写明的不动；思考档位只在协议一样时继承', () => {
    const builtin = findBuiltin('claude-opus-4-7', 'anthropic-messages', ALL)
    expect(
      enrichModel(
        { id: 'claude-opus-4-7', reasoning: true, input: ['text', 'image'], contextWindow: 500_000 },
        'anthropic-messages',
        builtin,
        ['reasoning', 'input'],
      ),
    ).toEqual({
      id: 'claude-opus-4-7',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 500_000, // 用户填的
      maxTokens: 128_000,
      thinkingLevelMap: { xhigh: 'xhigh', max: 'max' },
    })
    const ds = enrichModel(
      { id: 'deepseek-v4.1-flash', contextWindow: 1_000_000, input: ['text'] },
      'anthropic-messages',
      findBuiltin('deepseek-v4.1-flash', 'anthropic-messages', ALL),
      ['contextWindow'],
    )
    expect(ds).toEqual({ id: 'deepseek-v4.1-flash', contextWindow: 1_000_000, input: ['text'], maxTokens: 384_000 })
  })

  it('猜的窗口被内置的换掉（gpt-5.5 走 Codex 后端只有 272K）', () => {
    const out = enrichModel(
      { id: 'gpt-5.5', contextWindow: 500_000 },
      'openai-responses',
      findBuiltin('gpt-5.5', 'openai-responses', ALL),
      ['contextWindow'],
    )
    expect(out).toMatchObject({ contextWindow: 272_000, maxTokens: 128_000, thinkingLevelMap: { xhigh: 'xhigh' } })
  })
})

describe('网关扩展按内置表补全', () => {
  const env = {
    [PROVIDERS_ENV]: JSON.stringify({
      pixelsky: {
        baseUrl: 'http://127.0.0.1:9',
        api: 'anthropic-messages',
        apiKey: '$PIXELSKY_PIXEL_TOKEN',
        models: [{ id: 'claude-opus-4-7', reasoning: true, input: ['text', 'image'], contextWindow: 1_000_000 }],
      },
    }),
    [INFERRED_ENV]: JSON.stringify({ pixelsky: { 'claude-opus-4-7': ['reasoning', 'input', 'contextWindow'] } }),
  }

  it('INFERRED_ENV 格式不对当没有', () => {
    expect(inferredOf({ [INFERRED_ENV]: 'x' }, 'pixelsky')).toEqual({})
    expect(inferredOf(env, 'pixelsky')).toEqual({ 'claude-opus-4-7': ['reasoning', 'input', 'contextWindow'] })
  })

  it('没给模型表时和以前一样；给了就补上', () => {
    const plain = gatewayProviders(env).providers[0][1] as { models: Array<Record<string, unknown>> }
    expect(plain.models[0]).toMatchObject({ maxTokens: 16384 })
    expect(plain.models[0].thinkingLevelMap).toBeUndefined()
    const full = gatewayProviders(env, ALL).providers[0][1] as { models: Array<Record<string, unknown>> }
    expect(full.models[0]).toMatchObject({
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      thinkingLevelMap: { max: 'max' },
    })
  })

  it('会话开始时按 Pi 的模型表再注册一次', () => {
    const calls: Array<[string, { models?: Array<Record<string, unknown>> }]> = []
    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {}
    const before = { ...process.env }
    Object.assign(process.env, env)
    try {
      gatewayExtension({
        registerProvider: (name: string, config: never) => calls.push([name, config]),
        on: (event: string, fn: (event: unknown, ctx: unknown) => void) => (handlers[event] = fn),
      } as never)
      expect(calls).toHaveLength(1)
      handlers.session_start({}, { modelRegistry: { getAll: () => ALL } })
    } finally {
      for (const key of [PROVIDERS_ENV, INFERRED_ENV]) if (before[key] === undefined) delete process.env[key]
    }
    expect(calls).toHaveLength(2)
    expect(calls[1][1].models?.[0]).toMatchObject({ maxTokens: 128_000 })
  })
})

// Pi 1.3.0 内置表里的 compat（节选）
const COMPAT_ALL = [
  {
    provider: 'anthropic',
    id: 'claude-opus-4-7',
    api: 'anthropic-messages',
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    compat: { forceAdaptiveThinking: true, supportsTemperature: false, supportsStrictTools: true },
  },
  {
    provider: 'anthropic',
    id: 'claude-haiku-4-5',
    api: 'anthropic-messages',
    contextWindow: 200_000,
    maxTokens: 64_000,
    compat: { supportsStrictTools: true },
  },
  {
    provider: 'moonshotai',
    id: 'kimi-k3',
    api: 'openai-completions',
    contextWindow: 1_048_576,
    maxTokens: 1_048_576,
    input: ['text', 'image'],
    compat: {
      supportsReasoningEffort: true,
      thinkingFormat: 'openai',
      requiresReasoningContentOnAssistantMessages: true,
      supportsStrictMode: false,
    },
  },
  { provider: 'xai', id: 'grok-4.7', api: 'openai-responses', contextWindow: 500_000, maxTokens: 500_000 },
]

describe('compat：协议一样时继承跟着模型走的', () => {
  const opus = findBuiltin('claude-opus-4-7', 'anthropic-messages', COMPAT_ALL)

  it('新 Claude 继承自适应思考、不收 temperature；strict 工具这类看接口的不继承；桌面端写的 compat 照留', () => {
    expect(enrichModel({ id: 'claude-opus-4-7' }, 'anthropic-messages', opus, []).compat).toEqual({
      forceAdaptiveThinking: true,
      supportsTemperature: false,
    })
    const third = { supportsEagerToolInputStreaming: false, allowEmptySignature: true }
    expect(enrichModel({ id: 'claude-opus-4-7', compat: third }, 'anthropic-messages', opus, []).compat).toEqual({
      ...third,
      forceAdaptiveThinking: true,
      supportsTemperature: false,
    })
    // 桌面端写明的优先
    expect(
      enrichModel({ id: 'claude-opus-4-7', compat: { supportsTemperature: true } }, 'anthropic-messages', opus, [])
        .compat,
    ).toEqual({ supportsTemperature: true, forceAdaptiveThinking: true })
    // 老模型没有要继承的：不加 compat
    const haiku = findBuiltin('claude-haiku-4-5', 'anthropic-messages', COMPAT_ALL)
    expect(enrichModel({ id: 'claude-haiku-4-5' }, 'anthropic-messages', haiku, [])).not.toHaveProperty('compat')
  })

  it('协议不一样不继承（Claude 走 Chat 接口时）', () => {
    expect(enrichModel({ id: 'claude-opus-4-7' }, 'openai-completions', opus, [])).not.toHaveProperty('compat')
  })

  it('Chat：转售接口只继承 reasoning_content 那一项；厂商自己的接口（compat 标成猜的）以 Pi 表为准', () => {
    const kimi = findBuiltin('kimi-k3', 'openai-completions', COMPAT_ALL)
    const relay = { supportsStore: false, maxTokensField: 'max_tokens' }
    expect(enrichModel({ id: 'kimi-k3', compat: relay }, 'openai-completions', kimi, []).compat).toEqual({
      ...relay,
      requiresReasoningContentOnAssistantMessages: true,
    })
    const vendor = { supportsStore: false, supportsReasoningEffort: false, thinkingFormat: 'openai' }
    expect(enrichModel({ id: 'kimi-k3', compat: vendor }, 'openai-completions', kimi, ['compat']).compat).toEqual({
      supportsStore: false,
      supportsReasoningEffort: true,
      thinkingFormat: 'openai',
      requiresReasoningContentOnAssistantMessages: true,
      supportsStrictMode: false,
    })
  })

  it('最大输出最多给窗口的一半（Pi 表里和窗口一样大的）；桌面端写的不动', () => {
    const kimi = findBuiltin('kimi-k3', 'openai-completions', COMPAT_ALL)
    expect(enrichModel({ id: 'kimi-k3' }, 'openai-completions', kimi, []).maxTokens).toBe(524_288)
    const grok = findBuiltin('grok-4.7', 'openai-responses', COMPAT_ALL)
    expect(enrichModel({ id: 'grok-4.7' }, 'openai-responses', grok, []).maxTokens).toBe(250_000)
    // 用户给的窗口更小时按它的一半
    expect(
      enrichModel({ id: 'claude-opus-4-7', contextWindow: 200_000 }, 'anthropic-messages', opus, []).maxTokens,
    ).toBe(100_000)
    expect(enrichModel({ id: 'claude-opus-4-7' }, 'anthropic-messages', opus, []).maxTokens).toBe(128_000)
    expect(enrichModel({ id: 'kimi-k3', maxTokens: 900_000 }, 'openai-completions', kimi, []).maxTokens).toBe(900_000)
  })

  it('图片：Chat 默认只给文字（猜的），Pi 表里收图的模型能发图', () => {
    const kimi = findBuiltin('kimi-k3', 'openai-completions', COMPAT_ALL)
    expect(enrichModel({ id: 'kimi-k3', input: ['text'] }, 'openai-completions', kimi, ['input']).input).toEqual([
      'text',
      'image',
    ])
  })
})
