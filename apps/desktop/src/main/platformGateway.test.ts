import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import type { SessionRecord } from '@pixelsky/protocol'
import { platformGateway } from './platformGateway'
let server: Server
afterEach(() => { server?.closeAllConnections(); server?.close() })
describe('平台代理按引擎隔离 Responses 与 Messages', () => {
  it('选定账号 / 模型 / 线路才转发，退出或改回自有立即失效', async () => {
    let record = { id: 'session', engine: 'codex', model: 'model', platform: { groupId: '7', account: 'user' } } as SessionRecord
    let account: string | null = 'user'
    const tracked: string[] = []
    const calls: Array<{ path: string; group: string | null; body: unknown }> = []
    server = platformGateway({ sessions: new Map([['session', { recordId: 'session', secret: 'local-secret' }]]), record: () => record, account: () => account,
      requestContext: () => (id) => { tracked.push(id) },
      fetch: async (path, init) => { expect(new Headers(init.headers).get('X-Client-Request-ID')).toBe(tracked.at(-1)); calls.push({ path, group: new Headers(init.headers).get('X-PixelSky-Group'), body: JSON.parse(String(init.body)) }); return new Response('event: response.completed\ndata: {}\n\n', { headers: { 'Content-Type': 'text/event-stream', 'Retry-After': '5' } }) },
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port
    const send = (path = '/v1/responses', model = 'model', token = 'local-secret') => fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ model, stream: true }) })
    const good = await send(); expect(good.status).toBe(200); expect(good.headers.get('retry-after')).toBe('5'); expect(await good.text()).toContain('response.completed')
    expect(calls).toEqual([{ path: '/v1/platform/responses', group: '7', body: { model: 'model', stream: true } }])
    expect((await send('/v1/messages')).status).toBe(403)
    expect((await send('/v1/responses', 'other')).status).toBe(403)
    expect((await send('/v1/responses', 'model', 'invalid')).status).toBe(401)
    account = null; expect((await send()).status).toBe(401)
    account = 'user'; record = { ...record, platform: null }; expect((await send()).status).toBe(401)
    expect(calls).toHaveLength(1)
    expect(tracked).toHaveLength(1)
    expect(tracked[0]).toMatch(/^pixelsky-[a-f0-9-]{36}$/)
  })
})

it('waits for remote billing correlation before forwarding and fails closed on disconnect', async () => {
  let correlated = false, available = true, forwarded = 0
  const record = { id: 'remote', engine: 'codex', model: 'test-model', platform: { groupId: '7', account: 'test' } } as SessionRecord
  server = platformGateway({ sessions: new Map([['remote', { recordId: 'remote', secret: 'secret' }]]),
    record: async () => record, account: () => 'test',
    requestContext: () => async () => { await new Promise(r => setTimeout(r, 10)); if (!available) throw new Error('SSH_CONNECTION_CLOSED'); correlated = true },
    fetch: async () => { expect(correlated).toBe(true); forwarded++; return new Response('data: done\n\n') },
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = 'http://127.0.0.1:' + (server.address() as {port:number}).port
  const send = () => fetch(base + '/v1/responses', { method:'POST', headers:{ Authorization:'Bearer secret' }, body:JSON.stringify({model:'test-model'}) })
  expect((await send()).status).toBe(200)
  available = false; correlated = false
  expect((await send()).status).toBe(502)
  expect(forwarded).toBe(1)
})
