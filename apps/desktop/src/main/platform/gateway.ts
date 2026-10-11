import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { describeError, logger } from '@pixelsky/engine'
import type { SessionRecord } from '@pixelsky/protocol'
import type { ResolvedProvider } from '../core/providers/store'
import { classifyError, providerHeaders, upstreamUrl, type Fetch } from '../core/providers/upstream'

const log = logger('gateway')

/** buf 里最后一个完整 SSE 事件结束的位置（事件以空行结尾，\n\n 或 \r\n\r\n）；一个都没有时是 0 */
export function eventEnd(buf: Buffer): number {
  const lf = buf.lastIndexOf('\n\n'),
    crlf = buf.lastIndexOf('\r\n\r\n')
  return Math.max(lf < 0 ? 0 : lf + 2, crlf < 0 ? 0 : crlf + 4)
}

const midStreamError = `event: error\ndata: ${JSON.stringify({
  type: 'error',
  error: { type: 'api_error', message: '上游连接中途断开，这次请求已停止（不自动反复重试，避免重复计费）' },
})}\n\n`

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
    // 日志（docs/ui/logging.md §4.5）：断在哪一段、什么时候、转发了多少
    const started = Date.now()
    let headersAt: number | null = null
    let status: number | null = null
    let bytes = 0
    let requestId: string | null = null
    let sessionId: string | null = null
    const trace = (error?: unknown) => ({
      path,
      ...(sessionId ? { sessionId } : {}),
      ...(requestId ? { requestId } : {}),
      status,
      elapsedMs: Date.now() - started,
      streamMs: headersAt === null ? null : Date.now() - headersAt,
      bytes,
      ...(error === undefined ? {} : { error: describeError(error) }),
    })
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
      status = upstream.status
      headersAt = Date.now()
      res.writeHead(upstream.status, output)
      // Messages 的 SSE 只按完整事件转发：上游中途断开时能接一个 error 事件收尾，而不是掐断连接
      const sse = !responses && output['Content-Type'].includes('text/event-stream')
      let tail: Buffer = Buffer.alloc(0)
      try {
        if (upstream.body)
          for await (const chunk of upstream.body) {
            if (abort.signal.aborted) break
            bytes += chunk.length
            let out = Buffer.from(chunk)
            if (sse) {
              const all = tail.length ? Buffer.concat([tail, out]) : out
              const end = eventEnd(all)
              out = all.subarray(0, end)
              tail = all.subarray(end)
            }
            if (out.length && !res.write(out)) await once(res, 'drain', { signal: abort.signal })
          }
      } catch (error) {
        if (!sse || abort.signal.aborted) throw error
        // 掐断连接的话 Claude Code 当成网络抖动，最多重试十几次，每次都重发整段上下文、重新计费（压缩时尤其贵）；
        // 回 error 事件：普通请求它只改用非流式再试一次，压缩直接失败
        log.warn('上游连接中途断开', trace(error))
        res.end(midStreamError)
        return
      }
      if (tail.length) res.write(tail)
      res.end()
      if (abort.signal.aborted) log.info('引擎先断开了连接', trace())
      else if (upstream.status >= 400) log.warn('上游返回错误', trace())
      else log.debug('请求完成', trace())
    }
    const passthrough = (): Record<string, string> => {
      const out: Record<string, string> = {}
      for (const name of responses
        ? ['session_id', 'conversation_id', 'originator', 'openai-beta']
        : // Claude Code 的身份头：Sub2api「仅限 Claude Code」的分组靠 User-Agent / X-App / anthropic-beta 认终端
          ['anthropic-version', 'anthropic-beta', 'user-agent', 'x-app', 'anthropic-dangerous-direct-browser-access']) {
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
        log.warn('连不上自定义接口', trace(error))
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
      sessionId = record?.id ?? null
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
      requestId = `pixelsky-${randomUUID()}`
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
      if (abort.signal.aborted) log.info('引擎先断开了连接', trace(error))
      else if (res.headersSent) log.warn('上游连接中途断开', trace(error))
      else if ((error as { code?: unknown }).code !== 'AUTH_EXPIRED') log.warn('上游请求失败', trace(error))
      // 平台账号的登录失效（过期或被吊销）：401 加上原因，引擎不会当成暂时故障反复重试
      if (!res.headersSent)
        fail((error as { code?: unknown }).code === 'AUTH_EXPIRED' ? 401 : 502, (error as Error).message)
      else res.destroy()
    }
  })
}
