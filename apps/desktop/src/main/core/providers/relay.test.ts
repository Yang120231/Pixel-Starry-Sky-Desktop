import { describe, expect, it } from 'vitest'
import { relayBilling } from './relay'
import type { ResolvedProvider } from './store'
import type { Fetch } from './upstream'

const provider = (over: Partial<ResolvedProvider> = {}): ResolvedProvider => ({
  id: 'p1',
  name: '中转',
  template: 'custom',
  protocol: 'anthropic',
  baseUrl: 'https://relay.example.com',
  auth: 'x-api-key',
  models: [{ id: 'claude-sonnet-4-5' }, { id: 'deepseek-chat' }],
  smallModel: null,
  modelFallback: true,
  headerNames: [],
  createdAt: 0,
  updatedAt: 0,
  apiKey: 'sk-secret-1234',
  headers: {},
  ...over,
})

/** 按路径回假的响应，记下每次请求带的头 */
function fake(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, headers: init.headers as Record<string, string> })
    const path = new URL(url).pathname
    const r = routes[path]
    if (!r) return new Response('<html>not found</html>', { status: 404 })
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 })
  }
  return { fetch, calls }
}

describe('从中转站读取费用倍率', () => {
  it('sub2api：用 Key 查到实际倍率（不算高峰的填进去，高峰另外说明）', async () => {
    const { fetch, calls } = fake({
      '/v1/sub2api/billing': {
        body: {
          object: 'sub2api.key_billing',
          group_rate_multiplier: 0.8,
          resolved_rate_multiplier: 0.6,
          peak_rate_enabled: true,
          peak_start: '20:00',
          peak_end: '23:00',
          peak_rate_multiplier: 1.5,
          applied_peak_multiplier: 1,
          effective_rate_multiplier: 0.6,
        },
      },
    })
    // 接口地址带路径也只看根地址
    const b = await relayBilling(provider({ baseUrl: 'https://relay.example.com/anthropic' }), fetch)
    expect(b).toEqual({
      kind: 'sub2api',
      multiplier: 0.6,
      base: 0.6,
      peak: { start: '20:00', end: '23:00', multiplier: 1.5, active: false },
    })
    expect(calls[0].url).toBe('https://relay.example.com/v1/sub2api/billing')
    expect(calls[0].headers['x-api-key']).toBe('sk-secret-1234')
  })

  it('sub2api 认出 Key 但没分组：把它的说明告诉用户', async () => {
    const { fetch } = fake({
      '/v1/sub2api/billing': {
        status: 403,
        body: { error: { type: 'permission_error', message: 'API key is not assigned to a group' } },
      },
    })
    expect(await relayBilling(provider(), fetch)).toEqual({
      kind: 'unknown',
      message: 'API key is not assigned to a group',
    })
  })

  it('new-api：公开价格页（不带 Key）+ 充值折扣；模型对不上官方价或按次计费的为 null', async () => {
    const { fetch, calls } = fake({
      '/api/pricing': {
        body: {
          success: true,
          data: [
            { model_name: 'claude-sonnet-4-5', quota_type: 0, model_ratio: 1.5 },
            { model_name: 'deepseek-chat', quota_type: 1, model_price: 0.01 },
          ],
          group_ratio: { default: 1, vip: 0.8, bad: 'x' },
          usable_group: { default: '默认分组', vip: 'VIP' },
        },
      },
      '/api/status': { body: { success: true, data: { price: 2.5, usd_exchange_rate: 7.3, system_name: '某中转' } } },
    })
    const b = await relayBilling(provider(), fetch)
    expect(b).toMatchObject({
      kind: 'new-api',
      site: '某中转',
      groups: [
        { name: 'vip', label: 'VIP', ratio: 0.8 },
        { name: 'default', label: '默认分组', ratio: 1 },
      ],
    })
    if (b.kind !== 'new-api') throw new Error()
    // 1.5 × $2 / 官方 $3 = 1
    expect(b.models).toEqual([
      { id: 'claude-sonnet-4-5', factor: 1 },
      { id: 'deepseek-chat', factor: null },
    ])
    expect(b.recharge).toBeCloseTo(2.5 / 7.3)
    // 价格页和状态页都不带 Key
    for (const c of calls.filter(c => c.url.includes('/api/')))
      expect(JSON.stringify(c.headers)).not.toContain('sk-secret-1234')
  })

  it('new-api 没公开价格页、认不出的系统：返回原因，让用户手动填', async () => {
    const closed = fake({ '/api/pricing': { status: 403, body: { success: false, message: 'pricing is disabled' } } })
    expect(await relayBilling(provider(), closed.fetch)).toMatchObject({
      kind: 'unknown',
      message: expect.stringContaining('没有公开价格页'),
    })
    const none = fake({})
    expect(await relayBilling(provider(), none.fetch)).toMatchObject({
      kind: 'unknown',
      message: expect.stringContaining('认不出'),
    })
  })

  it('sub2api 那一步被跳转（不认识的路径跳到登录页）也接着试 new-api；new-api 分组只留用户能用的', async () => {
    const calls: string[] = []
    const fetch: Fetch = async url => {
      calls.push(url)
      if (url.endsWith('/v1/sub2api/billing')) throw new TypeError('fetch failed: unexpected redirect')
      if (url.endsWith('/api/pricing'))
        return new Response(
          JSON.stringify({
            success: true,
            data: [],
            group_ratio: { default: 1, internal: 0 },
            usable_group: { default: '默认' },
          }),
        )
      return new Response('{}', { status: 404 })
    }
    const b = await relayBilling(provider(), fetch)
    expect(b).toMatchObject({ kind: 'new-api', groups: [{ name: 'default', ratio: 1 }] })
  })

  it('连不上时报错（不吞掉）', async () => {
    const fetch: Fetch = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    }
    await expect(relayBilling(provider(), fetch)).rejects.toThrow('找不到这个域名')
  })
})
