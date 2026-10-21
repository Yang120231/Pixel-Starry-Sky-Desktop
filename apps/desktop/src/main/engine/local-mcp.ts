// 应用自己给引擎挂的只读 MCP 服务的 HTTP 部分（对话历史 history-mcp.ts、查看别的会话 threads-mcp.ts 共用）：
// 主进程里一个只绑 127.0.0.1 的 HTTP 服务（无状态，每个 POST 一个 MCP 服务器），每个会话一个令牌，令牌决定是哪个会话在调用。
// 第一次要给会话入口时才启动；拒绝带 Origin 的请求（浏览器页面）和 Host 不是回环地址的请求（DNS 重绑定）。
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

const PATH = '/mcp'
const BODY_LIMIT = 1024 * 1024

export interface LocalMcpEntry {
  url: string
  token: string
}

export interface LocalMcpHttp {
  /** 这个会话的地址和令牌（必要时先启动服务）；关闭后为 null */
  entry(sessionId: string): Promise<LocalMcpEntry | null>
  close(): void
}

/** 工具的只读标记：不用每次调用都等用户批准 */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

export type ToolArgs = Record<string, unknown>

export const toolText = (value: string, isError = false) => ({
  content: [{ type: 'text' as const, text: value }],
  ...(isError ? { isError } : {}),
})

/** 可选的整数参数：没给为 undefined；给了但不是整数则抛错 */
export function integer(args: ToolArgs, key: string): number | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`参数 ${key} 必须是整数`)
  return value
}

function reply(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  if (res.headersSent) return
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        resolve(null)
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** serverFor 给调用方会话建一个 MCP 服务器（每个请求一个） */
export function localMcpHttp(serverFor: (sessionId: string) => Server): LocalMcpHttp {
  const byToken = new Map<string, string>()
  const byId = new Map<string, string>()
  let http: HttpServer | null = null
  let starting: Promise<number> | null = null
  let closed = false

  const handle = async (req: IncomingMessage, res: ServerResponse, port: number): Promise<void> => {
    const host = (req.headers.host ?? '').toLowerCase()
    if (req.headers.origin !== undefined || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`))
      return reply(res, 403, '不允许这个来源')
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== PATH) return reply(res, 404, '没有这个地址')
    const header = req.headers.authorization ?? ''
    const sessionId = header.startsWith('Bearer ') ? byToken.get(header.slice(7).trim()) : undefined
    if (!sessionId) return reply(res, 401, '缺少或无效的令牌', { 'www-authenticate': 'Bearer' })
    if (req.method !== 'POST') return reply(res, 405, '只支持 POST', { allow: 'POST' })
    const raw = await readBody(req)
    if (raw === null) return reply(res, 413, '请求太大')
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return reply(res, 400, '请求不是有效的 JSON')
    }
    const server = serverFor(sessionId)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  }

  const start = (): Promise<number> => {
    starting ??= (async () => {
      const server = createServer((req, res) => {
        const address = server.address() as AddressInfo
        handle(req, res, address.port).catch(() => reply(res, 500, '内部错误'))
      })
      http = server
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      server.unref()
      return (server.address() as AddressInfo).port
    })()
    // 启动失败不缓存，下次再试
    starting.catch(() => {
      starting = null
      http = null
    })
    return starting
  }

  return {
    async entry(sessionId) {
      if (closed) return null
      const port = await start()
      if (closed) return null
      let token = byId.get(sessionId)
      if (!token) {
        token = randomBytes(32).toString('hex')
        byId.set(sessionId, token)
        byToken.set(token, sessionId)
      }
      return { url: `http://127.0.0.1:${port}${PATH}`, token }
    },
    close() {
      closed = true
      byToken.clear()
      byId.clear()
      http?.closeAllConnections()
      http?.close()
    },
  }
}
