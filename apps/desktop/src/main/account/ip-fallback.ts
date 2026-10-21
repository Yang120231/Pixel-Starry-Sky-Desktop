// 获取额度的兜底（docs/network-fallback.md）：正式站域名连不上（DNS 解析失败、连接失败或超时）时，
// 改连随版本内置的 CDN 节点 IP。只换连接地址，TLS 的 SNI 和 Host 仍是域名，证书照常校验；
// 源站只对 CDN 开放，不能直连。不依赖 electron，方便单测
import { request } from 'node:https'

/** 域名 → CDN 节点 IP（2026-10-21 解析结果，逐个实测证书有效）；测试站等不在表里的域名不兜底 */
export const FALLBACK_IPS: Readonly<Record<string, readonly string[]>> = {
  'pixelstarrysky.xyz': ['45.158.23.246', '172.247.44.156', '172.247.189.141', '172.247.189.210'],
}

/** 用备用 IP 连上之后，这段时间内直接用它，不再先等域名超时 */
export const PIN_MS = 10 * 60_000
/** 每个备用 IP 的超时 */
export const IP_TIMEOUT_MS = 8_000
const MAX_BODY = 1024 * 1024

// 「连不上」的错误码。证书错误、HTTP 状态码不算：前者可能是中间人，后者说明已经连上了
const UNREACHABLE = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
])
// 其中「一定还没连上」的：请求肯定没发出去，不幂等的请求（刷新令牌）也能放心换地址重发
const NOT_CONNECTED = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
])

/** fetch 抛的错误是不是「连不上」：TypeError('fetch failed') 的 cause 里带错误码，多个地址都失败时是 AggregateError */
export function isUnreachable(e: unknown, connectOnly = false, depth = 0): boolean {
  if (!(e instanceof Error) || depth > 4) return false
  if (e.name === 'TimeoutError') return !connectOnly
  const code = (e as { code?: unknown }).code
  if (typeof code === 'string' && (connectOnly ? NOT_CONNECTED : UNREACHABLE).has(code)) return true
  if (e instanceof AggregateError && e.errors.some(x => isUnreachable(x, connectOnly, depth + 1))) return true
  return isUnreachable(e.cause, connectOnly, depth + 1)
}

export interface IpRequest {
  method: string
  headers: Record<string, string>
  body?: string
}

/** 连到指定 IP 发一次 HTTPS 请求，SNI、Host、证书校验都按 url 里的域名 */
export function requestViaIp(
  url: URL,
  ip: string,
  init: IpRequest,
  timeoutMs = IP_TIMEOUT_MS,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: url.hostname,
        servername: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: init.method,
        headers: init.headers,
        agent: false, // 不复用连接池：池按域名分，里面可能是连到原地址的连接
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) =>
          opts?.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)) as never,
      },
      res => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_BODY) req.destroy(new Error('响应太大'))
          else chunks.push(c)
        })
        res.on('end', () => {
          clearTimeout(timer)
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') })
        })
        res.on('error', fail)
      },
    )
    const timer = setTimeout(
      () => req.destroy(Object.assign(new Error('请求超时'), { name: 'TimeoutError' })),
      timeoutMs,
    )
    function fail(e: Error): void {
      clearTimeout(timer)
      reject(e)
    }
    req.on('error', fail)
    req.end(init.body)
  })
}

// 证书或握手失败：一定还没把请求发出去
function isTlsError(e: unknown): boolean {
  const code = e instanceof Error ? (e as { code?: unknown }).code : undefined
  return (
    typeof code === 'string' &&
    (code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL') || /CERT|SELF_SIGNED|UNABLE_TO/.test(code))
  )
}

let pinned: { host: string; ip: string; until: number } | null = null

/** 测试用 */
export function resetIpFallback(): void {
  pinned = null
}

/**
 * 先直连域名；连不上就按顺序试备用 IP，哪个通用哪个，并记住 PIN_MS。
 * 记住期间先试这个 IP，它也连不上再回到直连。全都不通时抛直连的错误。
 * idempotent 为假（刷新令牌这类请求）时只在一定没连上时换地址；记住的 IP 失败也一样，可能已经发出去的不重发
 */
export async function withIpFallback<T>(
  url: string,
  direct: () => Promise<T>,
  viaIp: (ip: string) => Promise<T>,
  opts: { idempotent?: boolean; onSwitch?: (ip: string, reason: unknown) => void; now?: () => number } = {},
): Promise<T> {
  const { idempotent = true, onSwitch, now = Date.now } = opts
  const connectOnly = !idempotent
  const host = new URL(url).hostname
  const ips = FALLBACK_IPS[host]
  if (!ips?.length) return direct()
  if (pinned && pinned.host === host && pinned.until > now()) {
    try {
      return await viaIp(pinned.ip)
    } catch (e) {
      pinned = null
      if (!isUnreachable(e, connectOnly)) throw e
    }
  }
  try {
    return await direct()
  } catch (e) {
    if (!isUnreachable(e, connectOnly)) throw e
    for (const ip of ips) {
      try {
        const res = await viaIp(ip)
        pinned = { host, ip, until: now() + PIN_MS }
        onSwitch?.(ip, e)
        return res
      } catch (e2) {
        // 这个 IP 也不通（或证书对不上），试下一个；不幂等的请求可能已经发出去了就停
        if (connectOnly && !isUnreachable(e2, true) && !isTlsError(e2)) throw e2
      }
    }
    throw e
  }
}
