import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { SessionRecord } from '@pixelsky/protocol'
import type { ResolvedProvider } from '../core/providers/store'
import { classifyError, providerHeaders, upstreamUrl, type Fetch } from '../core/providers/upstream'

export interface GatewaySession {
  secret: string
  recordId: string
}

/**
 * 本机网关：平台和自定义 API 的会话都经过它（docs/ui/custom-api.md §4.1）。引擎只拿到本机地址和会话密钥，
 * 每个请求按会话的当前记录选上游：平台发往云端服务，自定义 API 换上真实 Key 发往用户填的地址。
 */
export function platformGateway(options: {
  sessions: Map<string, GatewaySession>
  record: (id: string) => SessionRecord | null | Promise<SessionRecord | null>
  account: () => string | null
  fetch: (path: string, init: RequestInit) => Promise<Response>
  /** Claude Code 压缩请求换模型；models 是这条线路 / 这个接口可用的模型 */
  rewrite?: (body: string, models: () => Promise<string[]>) => Promise<string>
  /** 平台线路的模型，压缩换模型时核对 */
  routeModels?: (groupId: string) => Promise<string[]>
  /** 自定义 API：按 id 取接口配置（带真实 Key） */
  provider?: (id: string) => ResolvedProvider | null
  /** 直接发往自定义接口的 fetch（测试时替换） */
  upstream?: Fetch
  requestContext?: (record: SessionRecord) => ((requestId: string, model: string) => void | Promise<void>) | undefined
}): Server {
  return createServer(async (req, res) => {
    const abort = new AbortController()
    res.on('close', () => abort.abort())
    const path = req.url?.split('?')[0] ?? ''
    const responses = path === '/v1/responses'
    const countTokens = path === '/v1/messages/count_tokens'
    const fail = (status: number, message: string): void => {
      res
        .writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(
          JSON.stringify(
            responses
              ? { error: { type: 'invalid_request_error', message } }
              : { type: 'error', error: { type: 'authentication_error', message } },
          ),
        )
    }
    const pipe = async (upstream: Response): Promise<void> => {
      const output: Record<string, string> = {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store',
      }
      for (const name of ['retry-after', 'x-request-id', 'request-id']) {
        const value = upstream.headers.get(name)
        if (value) output[name] = value
      }
      res.writeHead(upstream.status, output)
      if (upstream.body)
        for await (const chunk of upstream.body) {
          if (abort.signal.aborted) break
          if (!res.write(chunk)) await once(res, 'drain', { signal: abort.signal })
        }
      res.end()
    }
    const passthrough = (): Record<string, string> => {
      const out: Record<string, string> = {}
      for (const name of responses
        ? ['session_id', 'conversation_id', 'originator', 'openai-beta']
        : ['anthropic-version', 'anthropic-beta']) {
        const value = req.headers[name]
        if (typeof value === 'string') out[name] = value
      }
      return out
    }

    /**
     * 自定义 API：换上真实 Key 发往配置里的地址，不跟随跳转。请求的模型不在接口的模型列表里时（开关默认开），
     * Haiku 这类后台小任务换成后台小模型，其他换成会话当前的模型。
     */
    const forwardCustom = async (
      p: ResolvedProvider,
      record: SessionRecord,
      parsed: { model?: unknown },
      raw: string,
    ) => {
      let body = raw
      const ids = p.models.map(m => m.id)
      const requested = typeof parsed.model === 'string' ? parsed.model : null
      if (p.modelFallback && ids.length && (!requested || !ids.includes(requested))) {
        const small = requested && /haiku/i.test(requested) ? (p.smallModel ?? ids[0]) : null
        const current = record.model && ids.includes(record.model) ? record.model : ids[0]
        body = JSON.stringify({ ...parsed, model: small ?? current })
      }
      if (!responses && !countTokens && options.rewrite) body = await options.rewrite(body, async () => ids)
      const headers = providerHeaders(p, {
        'content-type': 'application/json',
        accept: countTokens ? 'application/json' : 'text/event-stream',
        ...passthrough(),
      })
      const url = upstreamUrl(p, path)
      let upstream: Response
      try {
        upstream = await (options.upstream ?? fetch)(url, {
          method: 'POST',
          headers,
          body,
          redirect: 'error',
          signal: abort.signal,
        })
      } catch (error) {
        if (abort.signal.aborted) throw error
        fail(502, classifyError(error, url).message)
        return
      }
      await pipe(upstream)
    }

    try {
      if (req.method !== 'POST' || (!responses && !countTokens && path !== '/v1/messages')) {
        fail(404, 'Unsupported gateway endpoint')
        return
      }
      const token = req.headers.authorization?.replace(/^Bearer /i, '') ?? req.headers['x-api-key']
      const session = [...options.sessions.values()].find(entry => entry.secret === token)
      const record = session ? await options.record(session.recordId) : null
      let provider: ResolvedProvider | null = null
      if (record?.provider && !record.platform) {
        provider = options.provider?.(record.provider.id) ?? null
        if (!provider) {
          fail(401, '这个会话用的自定义接口已删除，请换一个接口')
          return
        }
        if (provider.protocol !== (responses ? 'responses' : 'anthropic')) {
          fail(403, '接口协议与当前引擎不兼容')
          return
        }
        if (!provider.apiKey) {
          fail(401, `自定义接口「${provider.name}」还没有 Key，请在设置里填写`)
          return
        }
      } else if (!record?.platform || options.account() !== record.platform.account) {
        fail(401, '平台账号已退出或切换，请重新登录原账号')
        return
      } else if (countTokens) {
        fail(404, 'Unsupported gateway endpoint')
        return
      }
      if (record.engine !== (responses ? 'codex' : 'claude')) {
        fail(403, '线路协议与当前引擎不兼容')
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 32 * 1024 * 1024) {
          fail(413, 'Request exceeds size limit')
          return
        }
        chunks.push(Buffer.from(chunk))
      }
      let body = Buffer.concat(chunks).toString('utf8')
      let parsed: { model?: unknown }
      try {
        parsed = JSON.parse(body)
      } catch {
        fail(400, 'Invalid JSON request')
        return
      }
      if (provider) {
        await forwardCustom(provider, record, parsed, body)
        return
      }

      const platform = record.platform!
      const trackRequest = options.requestContext?.(record)
      if (responses && (!parsed.model || (record.model && parsed.model !== record.model))) {
        fail(403, '请求模型与当前平台会话不一致')
        return
      }
      const headers = new Headers({
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-PixelSky-Group': platform.groupId,
      })
      for (const [name, value] of Object.entries(passthrough())) headers.set(name, value)
      if (!responses && options.rewrite)
        body = await options.rewrite(body, () => options.routeModels?.(platform.groupId) ?? Promise.resolve([]))
      const requestId = `pixelsky-${randomUUID()}`
      headers.set('X-Client-Request-ID', requestId)
      await trackRequest?.(
        requestId,
        String((JSON.parse(body) as { model?: string }).model ?? record.model ?? 'unknown'),
      )
      const upstream = await options.fetch(responses ? '/v1/platform/responses' : '/v1/platform/messages', {
        method: 'POST',
        headers,
        body,
        signal: abort.signal,
      })
      await pipe(upstream)
    } catch (error) {
      if (!res.headersSent) fail(502, (error as Error).message)
      else res.destroy()
    }
  })
}
