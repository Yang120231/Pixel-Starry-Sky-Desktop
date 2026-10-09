import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { SessionRecord } from '@pixelsky/protocol'

export interface GatewaySession { secret: string; recordId: string }
export function platformGateway(options: {
  sessions: Map<string, GatewaySession>
  record: (id: string) => SessionRecord | null | Promise<SessionRecord | null>
  account: () => string | null
  fetch: (path: string, init: RequestInit) => Promise<Response>
  rewrite?: (body: string, groupId: string) => Promise<string>
  requestContext?: (record: SessionRecord) => ((requestId: string, model: string) => void | Promise<void>) | undefined
}): Server {
  return createServer(async (req, res) => {
    const abort = new AbortController()
    res.on('close', () => abort.abort())
    const path = req.url?.split('?')[0]
    const responses = path === '/v1/responses'
    const fail = (status: number, message: string): void => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(responses ? { error: { type: 'invalid_request_error', message } } : { type: 'error', error: { type: 'authentication_error', message } }))
    }
    try {
      if (req.method !== 'POST' || (!responses && path !== '/v1/messages')) { fail(404, 'Unsupported gateway endpoint'); return }
      const token = req.headers.authorization?.replace(/^Bearer /i, '') ?? req.headers['x-api-key']
      const session = [...options.sessions.values()].find(entry => entry.secret === token)
      const record = session ? await options.record(session.recordId) : null
      if (!record?.platform || options.account() !== record.platform.account) { fail(401, '平台账号已退出或切换，请重新登录原账号'); return }
      if (record.engine !== (responses ? 'codex' : 'claude')) { fail(403, '线路协议与当前引擎不兼容'); return }
      const trackRequest = options.requestContext?.(record)
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > 32 * 1024 * 1024) { fail(413, 'Request exceeds size limit'); return }; chunks.push(Buffer.from(chunk)) }
      let body = Buffer.concat(chunks).toString('utf8')
      let parsed: { model?: unknown }
      try { parsed = JSON.parse(body) } catch { fail(400, 'Invalid JSON request'); return }
      if (responses && (!parsed.model || (record.model && parsed.model !== record.model))) { fail(403, '请求模型与当前平台会话不一致'); return }
      const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-PixelSky-Group': record.platform.groupId })
      for (const name of responses ? ['session_id', 'conversation_id', 'originator', 'openai-beta'] : ['anthropic-version', 'anthropic-beta']) {
        const value = req.headers[name]; if (typeof value === 'string') headers.set(name, value)
      }
      if (!responses && options.rewrite) body = await options.rewrite(body, record.platform.groupId)
      const requestId = `pixelsky-${randomUUID()}`
      headers.set('X-Client-Request-ID', requestId)
      await trackRequest?.(requestId, String((JSON.parse(body) as { model?: string }).model ?? record.model ?? 'unknown'))
      const upstream = await options.fetch(responses ? '/v1/platform/responses' : '/v1/platform/messages', { method: 'POST', headers, body, signal: abort.signal })
      const output: Record<string, string> = { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store' }
      for (const name of ['retry-after', 'x-request-id', 'request-id']) { const value = upstream.headers.get(name); if (value) output[name] = value }
      res.writeHead(upstream.status, output)
      if (upstream.body) for await (const chunk of upstream.body) { if (abort.signal.aborted) break; if (!res.write(chunk)) await once(res, 'drain', { signal: abort.signal }) }
      res.end()
    } catch (error) { if (!res.headersSent) fail(502, (error as Error).message); else res.destroy() }
  })
}
