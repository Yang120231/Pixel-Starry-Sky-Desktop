import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 云端服务的契约样例（services/cloud/testdata/contract，见 docs/cloud-service.md §4.2.10）：
// Go 那边检查实际响应和样例的字段、类型一致，这里用同一份样例喂桌面端的解析代码。
// 改接口就必须改样例，两边的测试会一起失败。

const contractDir = fileURLToPath(new URL('../../../../../services/cloud/testdata/contract/', import.meta.url))

interface Sample {
  endpoint: string
  status: number
  body: unknown
}
// services/ 不进主仓库（独立的 git 仓库）：CI 和没拉云端代码的机器上没有样例，整组跳过
const hasSamples = existsSync(contractDir)

const sample = (name: string): Sample => JSON.parse(readFileSync(contractDir + name, 'utf8')) as Sample

const mocks = vi.hoisted(() => ({
  responses: new Map<string, { status: number; body: unknown }>(),
  paths: [] as string[],
}))
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('../account/account', () => ({
  signedInEmail: () => 'alice@example.com',
  // 按路径（不含查询串）回放样例
  platformFetch: async (path: string) => {
    mocks.paths.push(path)
    const hit = mocks.responses.get(path.split('?')[0])
    if (!hit) throw new Error('没有为 ' + path + ' 准备样例')
    return new Response(JSON.stringify(hit.body), {
      status: hit.status,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}))

const { platformGroups } = await import('./platform')
const { accountCalls, platformCharges } = await import('./billing')
const { fetchStore } = await import('../account/store')

function serve(path: string, s: Sample): void {
  mocks.responses.set(path, { status: s.status, body: s.body })
}

// 和 @pixelsky/protocol 的接口逐字段对上：字段名和 JS 类型
function expectFields(value: Record<string, unknown>, fields: Record<string, string | string[]>): void {
  for (const [key, type] of Object.entries(fields)) {
    const actual = value[key] === null ? 'null' : typeof value[key]
    expect([type].flat(), `${key} 的类型`).toContain(actual)
  }
}

beforeEach(() => {
  mocks.responses.clear()
  mocks.paths.length = 0
})

describe.skipIf(!hasSamples)('云端契约样例：平台分组', () => {
  it('公开分组的样例全部通过桌面端的筛选，字段原样保留', async () => {
    const s = sample('desktop/platform-groups.json')
    serve('/v1/platform/groups', s)
    const groups = await platformGroups()
    const data = (s.body as { data: unknown[] }).data
    expect(groups).toHaveLength(data.length)
    expect(groups).toEqual(data)
    for (const g of groups) expect(['claude', 'codex']).toEqual(expect.arrayContaining(g.supported_engines ?? []))
  })

  it('面板授权过期时显示云端给的提示', async () => {
    const s = sample('desktop/platform-groups-expired.json')
    serve('/v1/platform/groups', s)
    await expect(platformGroups()).rejects.toThrow((s.body as { error: string }).error)
  })
})

describe.skipIf(!hasSamples)('云端契约样例：调用明细', () => {
  it('调用明细一页能被 accountCalls 接受，每条记录的字段和类型符合 RemoteCall', async () => {
    serve('/v1/oauth/usage/calls', sample('desktop/usage-calls.json'))
    const page = await accountCalls({ range: '7d', now: Date.now(), offset: 0, limit: 50, model: null })
    expect(page.calls.length).toBeGreaterThan(0)
    expectFields(page as unknown as Record<string, unknown>, {
      total: 'number',
      offset: 'number',
      nextCursor: ['string', 'null'],
    })
    for (const call of page.calls)
      expectFields(call as unknown as Record<string, unknown>, {
        id: 'string',
        createdAt: 'number',
        model: 'string',
        client: 'string',
        device: ['string', 'null'],
        keyName: ['string', 'null'],
        stream: 'boolean',
        status: 'string',
        httpStatus: 'number',
        input: 'number',
        cacheRead: 'number',
        cacheWrite: 'number',
        output: 'number',
        costUsd: ['number', 'null'],
        firstTokenMs: ['number', 'null'],
        durationMs: 'number',
        turnId: ['string', 'null'],
        billing: 'string',
      })
    expect(mocks.paths[0]).toMatch(/^\/v1\/oauth\/usage\/calls\?offset=0&limit=50&/)
  })

  it('按请求 ID 查实扣金额能被 platformCharges 接受，字段和类型符合 PlatformCharge', async () => {
    const s = sample('desktop/usage-charges.json')
    serve('/v1/oauth/usage/calls', s)
    const requestId = (s.body as { charges: Array<{ requestId: string }> }).charges[0].requestId
    const charges = await platformCharges(
      {
        account: 'alice@example.com',
        requests: [{ id: requestId, model: 'm', groupId: '2' }],
        startedAt: Date.now(),
        complete: true,
      },
      AbortSignal.timeout(5000),
    )
    expect(charges).toHaveLength(1)
    expect(charges[0].requestId).toBe(requestId)
    expectFields(charges[0] as unknown as Record<string, unknown>, {
      requestId: 'string',
      model: 'string',
      groupId: 'string',
      costUsd: 'number',
      billing: 'string',
      rateMultiplier: 'number',
      input: 'number',
      output: 'number',
      cacheRead: 'number',
      cacheWrite: 'number',
    })
  })

  it('参数不对时云端回 400，桌面端报读取失败', async () => {
    serve('/v1/oauth/usage/calls', sample('desktop/usage-calls-invalid.json'))
    await expect(accountCalls({ range: '7d', now: Date.now(), offset: 0, limit: 50, model: null })).rejects.toThrow(
      '暂时无法读取账号调用记录',
    )
  })
})

describe.skipIf(!hasSamples)('云端契约样例：订阅套餐与充值（§4.16）', () => {
  it('支付开着：套餐、充值规则、支付方式逐项对上样例', async () => {
    const s = sample('desktop/store-open.json')
    serve('/v1/platform/store', s)
    const body = s.body as {
      plans: Array<Record<string, unknown>>
      recharge: Record<string, unknown>
      methods: Array<{ type: string; label: string }>
      help_text: string
      purchase_url: string
      redeem_url: string
    }
    const store = await fetchStore()
    expect(mocks.paths).toEqual(['/v1/platform/store'])
    expect(store.enabled).toBe(true)
    expect(store.currency).toBe('CNY')
    expect(store.plans).toHaveLength(body.plans.length)
    // 按 sort 排：GPT 周卡（sort 10，id 3）在 Claude 周卡（sort 20，id 1）前
    expect(store.plans.map(p => p.id)).toEqual([3, 1])
    const claude = store.plans.find(p => p.id === 1)!
    expect(claude).toMatchObject({
      name: 'Claude 周卡',
      price: 30,
      originalPrice: 40,
      validityDays: 7,
      groupName: 'Claude Sub',
      features: ['不限次数', '优先通道'],
      quotas: { fiveHour: 8, daily: 10, weekly: 50, monthly: null },
    })
    expect(store.plans.find(p => p.id === 3)!.originalPrice).toBeNull()
    expect(store.plans.find(p => p.id === 3)!.quotas).toEqual({
      fiveHour: null,
      daily: null,
      weekly: null,
      monthly: null,
    })
    expect(store.recharge).toEqual({
      enabled: true,
      min: 5,
      max: 500,
      multiplier: 1.5,
      feeRate: 2,
      bonusMode: 'bonus',
      bonusTiers: [
        { minAmount: 100, bonusPercent: 5 },
        { minAmount: 500, bonusPercent: 10 },
      ],
      usdToCnyRate: 7.2,
    })
    expect(store.methods).toEqual(body.methods)
    expect(store.helpText).toBe(body.help_text)
    expect(store.purchaseUrl).toBe(body.purchase_url)
    expect(store.redeemUrl).toBe(body.redeem_url)
  })

  it('支付关着：enabled=false，套餐、支付方式、档位全空', async () => {
    serve('/v1/platform/store', sample('desktop/store-closed.json'))
    const store = await fetchStore()
    expect(store.enabled).toBe(false)
    expect(store.plans).toEqual([])
    expect(store.methods).toEqual([])
    expect(store.recharge.enabled).toBe(false)
    expect(store.recharge.bonusTiers).toEqual([])
  })

  it('没有在售套餐：空套餐、充值关闭，但档位和帮助文字保留', async () => {
    serve('/v1/platform/store', sample('desktop/store-empty.json'))
    const store = await fetchStore()
    expect(store.enabled).toBe(true)
    expect(store.plans).toEqual([])
    expect(store.recharge.enabled).toBe(false)
    expect(store.recharge.bonusTiers).toHaveLength(2)
    expect(store.helpText).toBe('充值遇到问题请联系客服')
  })

  it('401 invalid_token 和 502 都报错，502 带云端给的提示', async () => {
    mocks.responses.set('/v1/platform/store', {
      status: 502,
      body: { error: '暂时读不到订阅套餐和充值信息，请稍后重试' },
    })
    await expect(fetchStore()).rejects.toThrow('暂时读不到订阅套餐和充值信息，请稍后重试')
    mocks.responses.set('/v1/platform/store', { status: 401, body: { error: 'invalid_token' } })
    await expect(fetchStore()).rejects.toThrow('invalid_token')
  })
})
