// 像素星空经网关的兼容性（docs/own-cli.md §12、§13）：按真实接口地址写的 compat、云端线路选协议、
// 网关回的错误（类型、余额不足、中途断开）和 Pi 的自动重试规则、模型名的 [1m] 后缀
import { once } from 'node:events'
import { realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { httpStatusOf, noticeErrorOf, type SessionRecord } from '@pixelsky/protocol'
import { MID_STREAM_TEXT, balanceText, gatewayErrorType, platformGateway, withoutLongContextSuffix } from './gateway'
import { THIRD_PARTY_ANTHROPIC_COMPAT, chatCompat, pixelApi, pixelModelCompat } from './pixel-env'
import { balanceProblem } from '../core/providers/upstream'
import type { ResolvedProvider } from '../core/providers/store'
import type { ProviderProtocol } from '../../shared/types/providers'

let server: Server | null = null
afterEach(() => {
  server?.closeAllConnections()
  server?.close()
  server = null
})

const provider = (protocol: ProviderProtocol, baseUrl: string, models = ['m']): ResolvedProvider =>
  ({
    id: 'p',
    name: 'Relay',
    template: 'custom',
    protocol,
    baseUrl,
    auth: 'bearer',
    models: models.map(id => ({ id })),
    smallModel: null,
    modelFallback: true,
    headerNames: [],
    apiKey: 'sk-real-key',
    headers: {},
  }) as unknown as ResolvedProvider

type Reply = (url: string, init: RequestInit) => Response | Promise<Response>

/** 起一个网关：p 给了走自定义接口，否则走云端线路（fetch 是云端） */
async function start(engine: string, reply: Reply, p: ResolvedProvider | null = null, model = 'm') {
  const calls: Array<{ url: string; body: string }> = []
  const record = {
    id: 's',
    engine,
    model,
    platform: p ? null : { groupId: '3', account: 'u' },
    provider: p ? { id: 'p' } : null,
  } as SessionRecord
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, body: String(init.body) })
    return reply(url, init)
  }
  server = platformGateway({
    sessions: new Map([['s', { recordId: 's', secret: 'local-secret' }]]),
    record: () => record,
    account: () => 'u',
    fetch: send,
    provider: () => p,
    upstream: send,
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  const post = (path: string, body: unknown) =>
    fetch(base + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer local-secret' },
      body: JSON.stringify(body),
    })
  return { calls, post }
}

const sse = (text: string) => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })

/** 先发 first，然后连接出错（上游中途断开） */
const broken = (first: string) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(first))
        setTimeout(() => controller.error(new Error('socket reset')), 20)
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('Chat Completions 的 compat：按真实接口地址（和 Pi 的 detectCompat 一样）', () => {
  it('OpenAI 官方：max_completion_tokens、store、developer 角色', () => {
    expect(chatCompat('https://api.openai.com/v1', 'gpt-5.5')).toMatchObject({
      maxTokensField: 'max_completion_tokens',
      supportsStore: true,
      supportsDeveloperRole: true,
      supportsReasoningEffort: true,
      thinkingFormat: 'openai',
    })
  })
  it('Azure：max_completion_tokens（推理模型不收 max_tokens），不发 store、用 system 角色', () => {
    expect(chatCompat('https://x.openai.azure.com/openai/v1', 'o4-mini')).toMatchObject({
      maxTokensField: 'max_completion_tokens',
      supportsStore: false,
      supportsDeveloperRole: false,
    })
  })
  it('Grok（api.x.ai）：不发 reasoning_effort', () => {
    expect(chatCompat('https://api.x.ai/v1', 'grok-4.7')).toMatchObject({
      supportsReasoningEffort: false,
      supportsStore: false,
      maxTokensField: 'max_completion_tokens',
    })
  })
  it('智谱（bigmodel / z.ai）：zai 的思考参数、max_tokens', () => {
    for (const url of ['https://open.bigmodel.cn/api/paas/v4', 'https://api.z.ai/api/coding/paas/v4'])
      expect(chatCompat(url, 'glm-5.2')).toMatchObject({
        thinkingFormat: 'zai',
        maxTokensField: 'max_tokens',
        supportsReasoningEffort: false,
      })
  })
  it('Kimi（moonshot）、DeepSeek', () => {
    expect(chatCompat('https://api.moonshot.cn/v1', 'kimi-k3')).toMatchObject({
      maxTokensField: 'max_tokens',
      supportsStore: false,
      supportsDeveloperRole: false,
    })
    expect(chatCompat('https://api.deepseek.com', 'deepseek-v4-pro')).toMatchObject({
      thinkingFormat: 'deepseek',
      requiresReasoningContentOnAssistantMessages: true,
      maxTokensField: 'max_tokens',
    })
  })
  it('OpenRouter：openrouter 的思考参数；Claude 带 cache_control；anthropic/、openai/ 用 developer 角色', () => {
    expect(chatCompat('https://openrouter.ai/api/v1', 'anthropic/claude-opus-4.7')).toMatchObject({
      thinkingFormat: 'openrouter',
      cacheControlFormat: 'anthropic',
      supportsDeveloperRole: true,
    })
    const other = chatCompat('https://openrouter.ai/api/v1', 'moonshotai/kimi-k3')
    expect(other).toMatchObject({ thinkingFormat: 'openrouter', supportsDeveloperRole: false })
    expect(other).not.toHaveProperty('cacheControlFormat')
  })
  it('认不出的转售接口：保守默认；OpenAI 推理模型用 max_completion_tokens，Grok 不发 reasoning_effort', () => {
    expect(chatCompat('https://relay.example/v1', 'deepseek-v4-pro')).toEqual({
      supportsUsageInStreaming: true,
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
    })
    expect(chatCompat('https://relay.example/v1', 'gpt-5.5')).toMatchObject({ maxTokensField: 'max_completion_tokens' })
    expect(chatCompat('https://relay.example/v1', 'openai/o3')).toMatchObject({
      maxTokensField: 'max_completion_tokens',
    })
    expect(chatCompat('https://relay.example/v1', 'gpt-4o')).toMatchObject({ maxTokensField: 'max_tokens' })
    expect(chatCompat('https://relay.example/v1', 'grok-4.7')).toMatchObject({ supportsReasoningEffort: false })
  })
})

describe('pixelModelCompat：哪些模型要写 compat、哪些交给 Pi 内置表', () => {
  it('Chat：厂商自己的接口把 compat 标成猜的（Pi 表里这家模型的 compat 优先），转售接口不标', () => {
    expect(pixelModelCompat('openai-completions', 'https://api.moonshot.ai/v1', 'kimi-k3').inferred).toEqual(['compat'])
    expect(pixelModelCompat('openai-completions', 'https://api.deepseek.com', 'x').inferred).toEqual(['compat'])
    expect(pixelModelCompat('openai-completions', 'https://relay.example/v1', 'kimi-k3').inferred).toBeUndefined()
  })
  it('Anthropic：第三方接口不发 Anthropic 才有的字段；官方地址、云端线路的 Claude 不改', () => {
    expect(pixelModelCompat('anthropic-messages', 'https://api.deepseek.com/anthropic', 'deepseek-v4-pro')).toEqual({
      compat: THIRD_PARTY_ANTHROPIC_COMPAT,
    })
    expect(pixelModelCompat('anthropic-messages', 'https://api.anthropic.com', 'claude-opus-4-7')).toEqual({})
    expect(pixelModelCompat('anthropic-messages', null, 'claude-opus-4-7')).toEqual({})
    expect(pixelModelCompat('anthropic-messages', null, 'kimi-k3')).toEqual({ compat: THIRD_PARTY_ANTHROPIC_COMPAT })
    expect(pixelModelCompat('openai-responses', null, 'gpt-5.5')).toEqual({})
  })
})

describe('云端线路的协议：分组声明的 supported_apis 优先', () => {
  it('只给一种的按它；两种都给时按平台原生的（openai、grok → Responses）；都没有按 Anthropic', () => {
    expect(pixelApi({ groupPlatform: 'anthropic', groupApis: ['responses'], model: 'deepseek-v4' })).toBe(
      'openai-responses',
    )
    expect(pixelApi({ groupPlatform: 'openai', groupApis: ['messages'], model: 'deepseek-v4' })).toBe(
      'anthropic-messages',
    )
    expect(pixelApi({ groupPlatform: 'grok', groupApis: ['responses', 'messages'], model: 'grok-4.7' })).toBe(
      'openai-responses',
    )
    expect(pixelApi({ groupPlatform: 'openai', groupApis: ['responses', 'messages'], model: 'codex-mini' })).toBe(
      'openai-responses',
    )
    expect(pixelApi({ groupPlatform: 'kimi', groupApis: ['messages'], model: 'kimi-k3' })).toBe('anthropic-messages')
    expect(pixelApi({ model: 'kimi-k3' })).toBe('anthropic-messages')
    // 官方模型名优先（claude → Messages）
    expect(pixelApi({ groupPlatform: 'openai', groupApis: ['responses'], model: 'claude-opus-4-7' })).toBe(
      'anthropic-messages',
    )
  })
})

describe('网关自己回的错误：类型按状态码', () => {
  it('不再一律 authentication_error', () => {
    expect([401, 402, 403, 404, 413, 429, 400, 500, 502, 503, 529].map(s => gatewayErrorType(s))).toEqual([
      'authentication_error',
      'billing_error',
      'permission_error',
      'not_found_error',
      'request_too_large',
      'rate_limit_error',
      'invalid_request_error',
      'api_error',
      'api_error',
      'overloaded_error',
      'overloaded_error',
    ])
    expect(gatewayErrorType(402, true)).toBe('insufficient_quota')
  })

  it('Messages：连不上自定义接口回 502 api_error，界面不再当成要重新登录', async () => {
    const { post } = await start(
      'pixel',
      () => {
        throw new TypeError('fetch failed')
      },
      provider('anthropic', 'https://relay.example'),
    )
    const res = await post('/v1/messages', { model: 'm' })
    expect(res.status).toBe(502)
    const body = await res.text()
    expect(JSON.parse(body)).toMatchObject({ type: 'error', error: { type: 'api_error' } })
    // Pi 的 Anthropic SDK 报的原文是「502 <整个错误体>」
    const text = `502 ${body}`
    expect(noticeErrorOf({ text, status: 502 })?.kind).not.toBe('auth')
  })
})

describe('余额不足 / 额度用完：像素星空的请求改成 402', () => {
  it('云端 Messages 403 billing_error → 402 billing_error，说明带 billing', async () => {
    const { post } = await start('pixel', () =>
      json(403, { type: 'error', error: { type: 'billing_error', message: 'Insufficient account balance' } }),
    )
    const res = await post('/v1/messages', { model: 'm', stream: true })
    expect(res.status).toBe(402)
    const body = (await res.json()) as { error: { type: string; message: string } }
    expect(body.error.type).toBe('billing_error')
    expect(body.error.message).toContain('平台余额不足')
    expect(body.error.message).toContain('Insufficient account balance')
  })

  it('云端 Responses 429 INSUFFICIENT_BALANCE（Sub2api 的 {code, message}）→ 402 insufficient_quota', async () => {
    const { post } = await start(
      'pixel',
      () => json(429, { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient account balance' }),
      null,
      'gpt-5.5',
    )
    const res = await post('/v1/responses', { model: 'gpt-5.5', stream: true })
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ error: { type: 'insufficient_quota', code: 'insufficient_quota' } })
  })

  it('额度用完也算；自定义接口的说明带接口名、去掉 Key', async () => {
    const { post } = await start(
      'pixel',
      () => json(429, { error: { message: 'API key quota exhausted for sk-real-key' } }),
      provider('chat', 'https://relay.example/v1'),
    )
    const res = await post('/v1/chat/completions', { model: 'm', stream: true })
    expect(res.status).toBe(402)
    const message = ((await res.json()) as { error: { message: string } }).error.message
    expect(message).toContain('自定义接口「Relay」的额度已用完')
    expect(message).not.toContain('sk-real-key')
  })

  it('别的 403 / 429 原样；Claude Code 的不改', async () => {
    const limited = await start('pixel', () => json(429, { error: { message: 'slow down' } }))
    expect((await limited.post('/v1/messages', { model: 'm' })).status).toBe(429)
    server?.closeAllConnections()
    server?.close()
    const claude = await start('claude', () =>
      json(403, { type: 'error', error: { type: 'billing_error', message: 'Insufficient account balance' } }),
    )
    const res = await claude.post('/v1/messages', { model: 'm' })
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('billing_error')
  })

  it('认得出的说法', () => {
    expect(balanceProblem('{"code":"INSUFFICIENT_BALANCE"}')).toBe('balance')
    expect(balanceProblem('{"error":"余额不足：这条线路按余额计费，请先充值"}')).toBe('balance')
    expect(balanceProblem('{"error":{"code":"insufficient_quota"}}')).toBe('balance')
    expect(balanceProblem('Subscription usage limit exceeded')).toBe('quota')
    expect(balanceProblem('{"error":{"message":"rate limited"}}')).toBeNull()
  })
})

describe('上游中途断开：像素星空收到协议里的终止错误，不是掐断的连接', () => {
  it('Responses：已转发的完整事件照旧，半截事件丢掉，补 response.failed', async () => {
    const { post } = await start(
      'pixel',
      () =>
        broken(
          'event: response.created\ndata: {"type":"response.created"}\n\nevent: response.output_text.delta\ndata: {"ty',
        ),
      null,
      'gpt-5.5',
    )
    const text = await (await post('/v1/responses', { model: 'gpt-5.5', stream: true })).text()
    expect(text.startsWith('event: response.created\ndata: {"type":"response.created"}\n\n')).toBe(true)
    expect(text).not.toContain('"ty\n')
    const failed = JSON.parse(text.split('event: response.failed\ndata: ')[1])
    expect(failed).toMatchObject({
      type: 'response.failed',
      response: { status: 'failed', error: { message: MID_STREAM_TEXT } },
    })
  })

  it('Chat：补一个带 error 的数据块', async () => {
    const { post } = await start(
      'pixel',
      () => broken('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'),
      provider('chat', 'https://relay.example/v1'),
    )
    const text = await (await post('/v1/chat/completions', { model: 'm', stream: true })).text()
    expect(text).toContain('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n')
    expect(text).toContain(`data: {"error":{"type":"stream_interrupted","message":"${MID_STREAM_TEXT}"}}`)
  })

  it('上游正常结束却没有收尾事件（云端 Responses 中途断开时）也补；有收尾的原样', async () => {
    const cut = await start('pixel', () => sse('data: {"type":"response.created"}\n\n'), null, 'gpt-5.5')
    expect(await (await cut.post('/v1/responses', { model: 'gpt-5.5', stream: true })).text()).toContain(
      'response.failed',
    )
    server?.closeAllConnections()
    server?.close()
    const done = 'data: {"type":"response.created"}\n\ndata: {"type":"response.completed","response":{}}\n\n'
    const ok = await start('pixel', () => sse(done), null, 'gpt-5.5')
    expect(await (await ok.post('/v1/responses', { model: 'gpt-5.5', stream: true })).text()).toBe(done)
    server?.closeAllConnections()
    server?.close()
    const messages = await start('pixel', () => sse('event: message_start\ndata: {"type":"message_start"}\n\n'))
    expect(await (await messages.post('/v1/messages', { model: 'm', stream: true })).text()).toContain('event: error')
  })

  it('Codex 的 Responses 照旧原样转发', async () => {
    const { post } = await start('codex', () => sse('data: {"type":"response.created"}\n\n'), null, 'gpt-5.5')
    expect(await (await post('/v1/responses', { model: 'gpt-5.5', stream: true })).text()).toBe(
      'data: {"type":"response.created"}\n\n',
    )
  })
})

describe('Pi 的自动重试规则（pi-ai utils/retry.js）', () => {
  // packages/cli 依赖的 Pi 旁边就是它的 pi-ai
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
  const agent = realpathSync(join(root, 'packages/cli/node_modules/@earendil-works/pi-coding-agent'))
  const retryable = async (errorMessage: string): Promise<boolean> => {
    const mod = (await import(pathToFileURL(join(agent, '..', 'pi-ai', 'dist', 'utils', 'retry.js')).href)) as {
      isRetryableAssistantError: (m: { stopReason: string; errorMessage: string }) => boolean
    }
    return mod.isRetryableAssistantError({ stopReason: 'error', errorMessage })
  }

  it('中途断开、余额不足的说明 Pi 都不会自动重试（掐断连接时的 terminated 会）', async () => {
    expect(await retryable('terminated')).toBe(true)
    // Anthropic SDK：事件原文；Responses：`代码: 说明`；Chat：说明
    expect(
      await retryable(JSON.stringify({ type: 'error', error: { type: 'api_error', message: MID_STREAM_TEXT } })),
    ).toBe(false)
    expect(await retryable(`stream_interrupted: ${MID_STREAM_TEXT}`)).toBe(false)
    expect(await retryable(MID_STREAM_TEXT)).toBe(false)
    const message = balanceText('quota', '平台', 'API key quota exhausted (429 rate limit)')
    expect(await retryable(`402 ${JSON.stringify({ type: 'error', error: { type: 'billing_error', message } })}`)).toBe(
      false,
    )
    expect(await retryable(`pixelsky API error (402): ${message}`)).toBe(false)
  })

  it('界面按 402 归成余额', () => {
    const text = `pixelsky API error (402): ${balanceText('balance', '平台', '')}`
    expect(noticeErrorOf({ text, status: httpStatusOf(text) })?.kind).toBe('balance')
  })
})

describe('模型名的 [1m] 后缀', () => {
  it('像素星空发出去之前去掉', async () => {
    expect(withoutLongContextSuffix('{"model":"claude-opus-4-7[1m]","x":1}')).toBe('{"model":"claude-opus-4-7","x":1}')
    const body = '{"model":"m","messages":[{"content":"[1m]"}]}'
    expect(withoutLongContextSuffix(body)).toBe(body)
    const custom = await start(
      'pixel',
      () => sse('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
      provider('anthropic', 'https://relay.example', ['claude-opus-4-7[1m]']),
      'claude-opus-4-7[1m]',
    )
    await custom.post('/v1/messages', { model: 'claude-opus-4-7[1m]', stream: true })
    expect(JSON.parse(custom.calls[0].body).model).toBe('claude-opus-4-7')
    server?.closeAllConnections()
    server?.close()
    const platform = await start(
      'pixel',
      () => sse('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
      null,
      'claude-opus-4-7[1m]',
    )
    await platform.post('/v1/messages', { model: 'claude-opus-4-7[1m]', stream: true })
    expect(JSON.parse(platform.calls[0].body).model).toBe('claude-opus-4-7')
  })

  it('Claude Code 的请求不动', async () => {
    const { calls, post } = await start(
      'claude',
      () => sse('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
      provider('anthropic', 'https://relay.example', ['claude-opus-4-7[1m]']),
    )
    await post('/v1/messages', { model: 'claude-opus-4-7[1m]' })
    expect(JSON.parse(calls[0].body).model).toBe('claude-opus-4-7[1m]')
  })
})
