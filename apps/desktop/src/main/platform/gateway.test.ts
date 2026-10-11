import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import type { SessionRecord } from '@pixelsky/protocol'
import { setLogSink } from '@pixelsky/engine'
import { eventEnd, platformGateway } from './gateway'
import type { ResolvedProvider } from '../core/providers/store'
let server: Server
afterEach(() => {
  server?.closeAllConnections()
  server?.close()
})
describe('平台代理按引擎隔离 Responses 与 Messages', () => {
  it('选定账号 / 模型 / 线路才转发，退出或改回自有立即失效', async () => {
    let record = {
      id: 'session',
      engine: 'codex',
      model: 'model',
      platform: { groupId: '7', account: 'user' },
    } as SessionRecord
    let account: string | null = 'user'
    const tracked: string[] = []
    const calls: Array<{ path: string; group: string | null; body: unknown }> = []
    server = platformGateway({
      sessions: new Map([['session', { recordId: 'session', secret: 'local-secret' }]]),
      record: () => record,
      account: () => account,
      requestContext: () => id => {
        tracked.push(id)
      },
      fetch: async (path, init) => {
        expect(new Headers(init.headers).get('X-Client-Request-ID')).toBe(tracked.at(-1))
        calls.push({
          path,
          group: new Headers(init.headers).get('X-PixelSky-Group'),
          body: JSON.parse(String(init.body)),
        })
        return new Response('event: response.completed\ndata: {}\n\n', {
          headers: { 'Content-Type': 'text/event-stream', 'Retry-After': '5' },
        })
      },
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port
    const send = (path = '/v1/responses', model = 'model', token = 'local-secret') =>
      fetch(base + path, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: JSON.stringify({ model, stream: true }),
      })
    const good = await send()
    expect(good.status).toBe(200)
    expect(good.headers.get('retry-after')).toBe('5')
    expect(await good.text()).toContain('response.completed')
    expect(calls).toEqual([{ path: '/v1/platform/responses', group: '7', body: { model: 'model', stream: true } }])
    expect((await send('/v1/messages')).status).toBe(403)
    expect((await send('/v1/responses', 'other')).status).toBe(403)
    expect((await send('/v1/responses', 'model', 'invalid')).status).toBe(401)
    account = null
    expect((await send()).status).toBe(401)
    account = 'user'
    record = { ...record, platform: null }
    expect((await send()).status).toBe(401)
    expect(calls).toHaveLength(1)
    expect(tracked).toHaveLength(1)
    expect(tracked[0]).toMatch(/^pixelsky-[a-f0-9-]{36}$/)
  })

  it('Messages 把 Claude Code 的身份头带给云端（Sub2api「仅限 Claude Code」分组靠它认终端）', async () => {
    let forwarded: Headers | null = null
    server = platformGateway({
      sessions: new Map([['s', { recordId: 's', secret: 'local-secret' }]]),
      record: () => ({ id: 's', engine: 'claude', platform: { groupId: '2', account: 'user' } }) as SessionRecord,
      account: () => 'user',
      fetch: async (_path, init) => {
        forwarded = new Headers(init.headers)
        return new Response('event: message_stop\ndata: {}\n\n')
      },
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port
    const identity = {
      'user-agent': 'claude-cli/2.1.0 (external, cli)',
      'x-app': 'cli',
      'anthropic-beta': 'claude-code-20250219',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }
    const res = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer local-secret', ...identity },
      body: JSON.stringify({ model: 'claude-sonnet-5' }),
    })
    expect(res.status).toBe(200)
    await res.text()
    expect(Object.fromEntries(forwarded!)).toMatchObject(identity)
    expect(forwarded!.get('authorization')).toBeNull()
  })

  it('平台账号登录失效（过期或被吊销）：回 401 和原因，不是 502', async () => {
    server = platformGateway({
      sessions: new Map([['s', { recordId: 's', secret: 'local-secret' }]]),
      record: () => ({ id: 's', engine: 'claude', platform: { groupId: '2', account: 'user' } }) as SessionRecord,
      account: () => 'user',
      fetch: async () => {
        throw Object.assign(new Error('登录已失效（已过期或被吊销），请重新登录'), { code: 'AUTH_EXPIRED' })
      },
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const res = await fetch('http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer local-secret' },
      body: JSON.stringify({ model: 'claude-sonnet-5' }),
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { message: expect.stringContaining('请重新登录') } })
  })
})

it('上游输出到一半断开：记一条日志，带请求 ID、状态码、已转发字节和错误码链（docs/ui/logging.md §4.5）', async () => {
  const logs: { level: string; message: string; fields?: Record<string, unknown> }[] = []
  setLogSink({ enabled: () => true, write: (level, _scope, message, fields) => logs.push({ level, message, fields }) })
  try {
    server = platformGateway({
      sessions: new Map([['s', { recordId: 's', secret: 'local-secret' }]]),
      record: () => ({ id: 's', engine: 'claude', platform: { groupId: '2', account: 'user' } }) as SessionRecord,
      account: () => 'user',
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('event: message_start\n\n'))
              setTimeout(
                () =>
                  controller.error(
                    new TypeError('terminated', {
                      cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
                    }),
                  ),
                20,
              )
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const res = await fetch('http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer local-secret' },
      body: JSON.stringify({ model: 'claude-sonnet-5' }),
    })
    expect(res.status).toBe(200)
    // 不掐断连接：已转发的完整事件之后接一个 error 事件正常结束（Claude Code 不会反复重试）
    const text = await res.text()
    expect(text.startsWith('event: message_start\n\nevent: error\n')).toBe(true)
    expect(JSON.parse(text.split('data: ')[1])).toMatchObject({ type: 'error', error: { type: 'api_error' } })
    const broken = logs.find(l => l.message === '上游连接中途断开')
    expect(broken?.level).toBe('warn')
    expect(broken?.fields).toMatchObject({
      path: '/v1/messages',
      sessionId: 's',
      requestId: expect.stringMatching(/^pixelsky-/),
      status: 200,
      bytes: 22,
      error: 'TypeError terminated ← UND_ERR_SOCKET other side closed',
    })
    expect(broken?.fields?.streamMs).toEqual(expect.any(Number))
  } finally {
    setLogSink(null)
  }
})

it('中途断开时丢掉不完整的事件再接 error 事件；完整结束时原样转发（含不完整的结尾）', async () => {
  const broken = (parts: string[], fail: boolean) =>
    new Response(
      new ReadableStream({
        async start(controller) {
          for (const part of parts) {
            controller.enqueue(new TextEncoder().encode(part))
            await new Promise(r => setTimeout(r, 5))
          }
          if (fail) controller.error(new TypeError('terminated'))
          else controller.close()
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  let next: () => Response = () => broken([], false)
  server = platformGateway({
    sessions: new Map([['s', { recordId: 's', secret: 'local-secret' }]]),
    record: () => ({ id: 's', engine: 'claude', platform: { groupId: '2', account: 'user' } }) as SessionRecord,
    account: () => 'user',
    fetch: async () => next(),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const post = () =>
    fetch('http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer local-secret' },
      body: JSON.stringify({ model: 'claude-sonnet-5' }),
    })
  next = () => broken(['event: a\ndata: {}\n\nevent: b\nda', 'ta: {"x":1}\n\nevent: c\ndata: {"half'], true)
  const cut = await (await post()).text()
  expect(cut.startsWith('event: a\ndata: {}\n\nevent: b\ndata: {"x":1}\n\nevent: error\n')).toBe(true)
  expect(cut).not.toContain('half')
  next = () => broken(['event: a\r\ndata: {}\r\n\r\nevent: b\ndata: {"tail', '":1}'], false)
  expect(await (await post()).text()).toBe('event: a\r\ndata: {}\r\n\r\nevent: b\ndata: {"tail":1}')
  expect(eventEnd(Buffer.from('no boundary'))).toBe(0)
})

it('waits for remote billing correlation before forwarding and fails closed on disconnect', async () => {
  let correlated = false,
    available = true,
    forwarded = 0
  const record = {
    id: 'remote',
    engine: 'codex',
    model: 'test-model',
    platform: { groupId: '7', account: 'test' },
  } as SessionRecord
  server = platformGateway({
    sessions: new Map([['remote', { recordId: 'remote', secret: 'secret' }]]),
    record: async () => record,
    account: () => 'test',
    requestContext: () => async () => {
      await new Promise(r => setTimeout(r, 10))
      if (!available) throw new Error('SSH_CONNECTION_CLOSED')
      correlated = true
    },
    fetch: async () => {
      expect(correlated).toBe(true)
      forwarded++
      return new Response('data: done\n\n')
    },
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  const send = () =>
    fetch(base + '/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: JSON.stringify({ model: 'test-model' }),
    })
  expect((await send()).status).toBe(200)
  available = false
  correlated = false
  expect((await send()).status).toBe(502)
  expect(forwarded).toBe(1)
})

describe('自定义 API 经本机网关（docs/ui/custom-api.md §4.1）', () => {
  const provider = (over: Partial<ResolvedProvider> = {}): ResolvedProvider => ({
    id: 'p1',
    name: 'Relay',
    template: 'custom',
    protocol: 'anthropic',
    baseUrl: 'https://relay.example.com/anthropic',
    auth: 'x-api-key',
    models: [{ id: 'deepseek-chat' }, { id: 'deepseek-lite' }],
    smallModel: 'deepseek-lite',
    modelFallback: true,
    headerNames: ['X-Org'],
    createdAt: 0,
    updatedAt: 0,
    apiKey: 'sk-real-key',
    headers: { 'X-Org': 'org-1' },
    ...over,
  })

  it('换上真实 Key 和附加请求头、不跟随跳转；不认识的模型换成后台小模型或当前模型；平台的云端不经手', async () => {
    let record = {
      id: 's',
      engine: 'claude',
      model: 'deepseek-chat',
      platform: null,
      provider: { id: 'p1' },
    } as SessionRecord
    let current: ResolvedProvider | null = provider()
    const calls: { url: string; init: RequestInit }[] = []
    server = platformGateway({
      sessions: new Map([['s', { recordId: 's', secret: 'local-secret' }]]),
      record: () => record,
      account: () => null,
      fetch: async () => {
        throw new Error('platform fetch must not be used')
      },
      provider: () => current,
      upstream: async (url, init) => {
        calls.push({ url, init })
        if (url.includes('fail'))
          throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
        return new Response('event: message_stop\ndata: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      },
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port
    const send = (model: string, path = '/v1/messages', token = 'local-secret') =>
      fetch(base + path, {
        method: 'POST',
        headers: {
          'x-api-key': token,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'b1',
          'user-agent': 'claude-cli/2.1.0 (external, cli)',
          'x-app': 'cli',
        },
        body: JSON.stringify({ model, max_tokens: 5 }),
      })

    const ok = await send('deepseek-chat')
    expect(ok.status).toBe(200)
    expect(await ok.text()).toContain('message_stop')
    const first = calls[0]
    const headers = first.init.headers as Record<string, string>
    expect(first.url).toBe('https://relay.example.com/anthropic/v1/messages')
    expect(first.init.redirect).toBe('error')
    expect(headers).toMatchObject({
      'x-api-key': 'sk-real-key',
      'X-Org': 'org-1',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'b1',
      'user-agent': 'claude-cli/2.1.0 (external, cli)',
      'x-app': 'cli',
    })
    expect(JSON.stringify(headers)).not.toContain('local-secret')
    expect(JSON.parse(String(first.init.body)).model).toBe('deepseek-chat')

    await send('claude-haiku-4-5')
    expect(JSON.parse(String(calls[1].init.body)).model).toBe('deepseek-lite')
    await send('claude-sonnet-4-5')
    expect(JSON.parse(String(calls[2].init.body)).model).toBe('deepseek-chat')
    expect((await send('deepseek-chat', '/v1/messages/count_tokens')).status).toBe(200)
    expect(calls[3].url).toBe('https://relay.example.com/anthropic/v1/messages/count_tokens')

    // 兜底关掉：原样转发
    current = provider({ modelFallback: false })
    await send('claude-sonnet-4-5')
    expect(JSON.parse(String(calls[4].init.body)).model).toBe('claude-sonnet-4-5')

    // 连不上：502 + 人话；错的会话密钥 401；协议不对 403；没 Key 401；接口删了 401
    current = provider({ baseUrl: 'https://fail.example.com' })
    const down = await send('deepseek-chat')
    expect(down.status).toBe(502)
    expect(await down.text()).toContain('连接被拒绝')
    current = provider()
    expect((await send('deepseek-chat', '/v1/messages', 'wrong')).status).toBe(401)
    expect((await send('deepseek-chat', '/v1/responses')).status).toBe(403)
    current = provider({ apiKey: null })
    expect((await send('deepseek-chat')).status).toBe(401)
    current = null
    const gone = await send('deepseek-chat')
    expect(gone.status).toBe(401)
    expect(await gone.text()).toContain('已删除')
    // 会话改回自有：旧进程的请求一律拒绝
    current = provider()
    record = { ...record, provider: null }
    expect((await send('deepseek-chat')).status).toBe(401)
    expect(calls).toHaveLength(6)
  })

  it('Codex + Responses 接口：Bearer 认证，网关的 /v1/responses 拼到带 /v1 的地址上', async () => {
    const record = { id: 's', engine: 'codex', model: 'gpt-5', platform: null, provider: { id: 'p2' } } as SessionRecord
    const calls: { url: string; init: RequestInit }[] = []
    server = platformGateway({
      sessions: new Map([['s', { recordId: 's', secret: 'local-secret' }]]),
      record: () => record,
      account: () => null,
      fetch: async () => {
        throw new Error('platform fetch must not be used')
      },
      provider: () =>
        provider({
          protocol: 'responses',
          baseUrl: 'https://api.openai.com/v1',
          auth: 'bearer',
          models: [{ id: 'gpt-5' }],
          smallModel: null,
          headerNames: [],
          headers: {},
        }),
      upstream: async (url, init) => {
        calls.push({ url, init })
        return new Response('data: {}\n\n')
      },
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port
    const res = await fetch(base + '/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer local-secret', session_id: 'abc' },
      body: JSON.stringify({ model: 'gpt-5', stream: true }),
    })
    expect(res.status).toBe(200)
    expect(calls[0].url).toBe('https://api.openai.com/v1/responses')
    expect(calls[0].init.headers).toMatchObject({ authorization: 'Bearer sk-real-key', session_id: 'abc' })
  })
})
