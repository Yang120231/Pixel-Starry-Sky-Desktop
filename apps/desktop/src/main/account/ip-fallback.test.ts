import { afterEach, describe, expect, it } from 'vitest'
import { FALLBACK_IPS, isUnreachable, PIN_MS, resetIpFallback, withIpFallback } from './ip-fallback'

const URL_PROD = 'https://pixelstarrysky.xyz/v1/oauth/account'
const IPS = FALLBACK_IPS['pixelstarrysky.xyz']

const coded = (code: string): Error => Object.assign(new Error(code), { code })
const fetchFailed = (code: string): TypeError => new TypeError('fetch failed', { cause: coded(code) })
const timeout = (): Error => Object.assign(new Error('timeout'), { name: 'TimeoutError' })

afterEach(() => resetIpFallback())

describe('isUnreachable', () => {
  it('DNS 失败、连接失败、超时算连不上', () => {
    for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'])
      expect(isUnreachable(fetchFailed(code)), code).toBe(true)
    expect(isUnreachable(timeout())).toBe(true)
    expect(isUnreachable(new TypeError('fetch failed', { cause: new AggregateError([coded('ECONNREFUSED')]) }))).toBe(
      true,
    )
  })

  it('证书错误、没有错误码的都不算', () => {
    expect(isUnreachable(fetchFailed('CERT_HAS_EXPIRED'))).toBe(false)
    expect(isUnreachable(fetchFailed('ERR_TLS_CERT_ALTNAME_INVALID'))).toBe(false)
    expect(isUnreachable(new TypeError('fetch failed'))).toBe(false)
    expect(isUnreachable('x')).toBe(false)
  })

  it('connectOnly：只认一定没连上的，连接重置、超时不算（请求可能已经发出去）', () => {
    expect(isUnreachable(fetchFailed('ENOTFOUND'), true)).toBe(true)
    expect(isUnreachable(fetchFailed('ECONNREFUSED'), true)).toBe(true)
    expect(isUnreachable(fetchFailed('ECONNRESET'), true)).toBe(false)
    expect(isUnreachable(timeout(), true)).toBe(false)
  })
})

describe('withIpFallback', () => {
  it('直连能通就不碰备用 IP', async () => {
    const tried: string[] = []
    const r = await withIpFallback(
      URL_PROD,
      async () => 'direct',
      async ip => (tried.push(ip), ip),
    )
    expect(r).toBe('direct')
    expect(tried).toEqual([])
  })

  it('不在表里的域名（测试站）不兜底', async () => {
    const tried: string[] = []
    await expect(
      withIpFallback(
        'https://auth.pixelstarrysky.xyz/v1/oauth/account',
        () => Promise.reject(fetchFailed('ENOTFOUND')),
        async ip => (tried.push(ip), ip),
      ),
    ).rejects.toThrow('fetch failed')
    expect(tried).toEqual([])
  })

  it('连不上就按顺序试备用 IP，用第一个通的，并记住一段时间', async () => {
    let t = 1000
    const tried: string[] = []
    const switched: string[] = []
    let directCalls = 0
    const direct = (): Promise<string> => (directCalls++, Promise.reject(fetchFailed('ENOTFOUND')))
    const viaIp = async (ip: string): Promise<string> => {
      tried.push(ip)
      if (ip === IPS[0]) throw fetchFailed('ECONNREFUSED')
      return ip
    }
    const opts = { onSwitch: (ip: string) => switched.push(ip), now: () => t }
    expect(await withIpFallback(URL_PROD, direct, viaIp, opts)).toBe(IPS[1])
    expect(tried).toEqual([IPS[0], IPS[1]])
    expect(switched).toEqual([IPS[1]])

    // 记住期间直接用它，不再先等直连
    tried.length = 0
    expect(await withIpFallback(URL_PROD, direct, viaIp, opts)).toBe(IPS[1])
    expect(tried).toEqual([IPS[1]])
    expect(directCalls).toBe(1)

    // 过期后先回到直连
    t += PIN_MS + 1
    tried.length = 0
    await withIpFallback(URL_PROD, direct, viaIp, opts)
    expect(directCalls).toBe(2)
    expect(tried[0]).toBe(IPS[0])
  })

  it('记住的 IP 不通了就回到直连', async () => {
    const down = new Set<string>()
    const viaIp = async (ip: string): Promise<string> => {
      if (down.has(ip)) throw fetchFailed('ECONNREFUSED')
      return ip
    }
    await withIpFallback(URL_PROD, () => Promise.reject(fetchFailed('ENOTFOUND')), viaIp)
    down.add(IPS[0])
    expect(await withIpFallback(URL_PROD, async () => 'direct', viaIp)).toBe('direct')
  })

  it('证书错误不换地址（可能是中间人）', async () => {
    const tried: string[] = []
    await expect(
      withIpFallback(
        URL_PROD,
        () => Promise.reject(fetchFailed('CERT_HAS_EXPIRED')),
        async ip => (tried.push(ip), ip),
      ),
    ).rejects.toThrow('fetch failed')
    expect(tried).toEqual([])
  })

  it('全都不通时抛直连的错误', async () => {
    const original = fetchFailed('ENOTFOUND')
    await expect(
      withIpFallback(
        URL_PROD,
        () => Promise.reject(original),
        () => Promise.reject(fetchFailed('ECONNREFUSED')),
      ),
    ).rejects.toBe(original)
  })

  it('不幂等的请求：直连超时、备用 IP 超时都不重发', async () => {
    const tried: string[] = []
    await expect(
      withIpFallback(
        URL_PROD,
        () => Promise.reject(timeout()),
        async ip => (tried.push(ip), ip),
        { idempotent: false },
      ),
    ).rejects.toThrow('timeout')
    expect(tried).toEqual([])

    await expect(
      withIpFallback(
        URL_PROD,
        () => Promise.reject(fetchFailed('ENOTFOUND')),
        async ip => {
          tried.push(ip)
          throw timeout()
        },
        { idempotent: false },
      ),
    ).rejects.toThrow('timeout')
    expect(tried).toEqual([IPS[0]])
  })
})
