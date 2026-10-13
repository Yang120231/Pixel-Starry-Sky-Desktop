import { beforeEach, describe, expect, it, vi } from 'vitest'

// 订阅套餐与充值：解析云端响应、校验打开浏览器的地址（docs/cloud-service.md §4.16）。

const mocks = vi.hoisted(() => ({
  opened: [] as string[],
  email: 'alice@example.com' as string | null,
  response: { status: 200, body: {} as unknown },
}))
vi.mock('electron', () => ({
  shell: {
    openExternal: async (url: string) => {
      mocks.opened.push(url)
    },
  },
}))
vi.mock('./account', () => ({
  signedInEmail: () => mocks.email,
  platformFetch: async () =>
    new Response(JSON.stringify(mocks.response.body), {
      status: mocks.response.status,
      headers: { 'Content-Type': 'application/json' },
    }),
}))

const { fetchStore, openStore, parseStore, storeLink } = await import('./store')

const open = {
  enabled: true,
  currency: 'CNY',
  plans: [
    {
      id: 2,
      name: 'B',
      price: 60,
      sort: 20,
      validity_days: 30,
      quotas: { five_hour: 1, daily: null, weekly: 2, monthly: null },
      extra_field: 'ignored',
    },
    { id: 1, name: 'A', price: 30, sort: 20, original_price: 40, currency: 'USD', features: ['x', 3, ''] },
  ],
  recharge: { enabled: true, min: 5, max: 0, multiplier: 2, fee_rate: 1.5, bonus_mode: 'discount', bonus_tiers: [] },
  methods: [{ type: 'alipay', label: '支付宝' }, { type: 'stripe' }, { label: 'no type' }],
  help_text: 'hi',
  purchase_url: 'https://panel.example.com/purchase',
  redeem_url: 'https://panel.example.com/redeem',
  unknown_top_level: true,
}

beforeEach(() => {
  mocks.opened.length = 0
  mocks.email = 'alice@example.com'
  mocks.response = { status: 200, body: open }
})

describe('parseStore', () => {
  it('蛇形转驼峰，多余字段忽略，同 sort 按 id 排', () => {
    const s = parseStore(open)
    expect(s.plans.map(p => p.id)).toEqual([1, 2])
    expect(s.plans[0]).toMatchObject({
      originalPrice: 40,
      currency: 'USD',
      validityDays: 0,
      features: ['x'],
      groupName: '',
      groupId: null,
      description: '',
    })
    expect(s.plans[1].quotas).toEqual({ fiveHour: 1, daily: null, weekly: 2, monthly: null })
    expect(s.plans[1].originalPrice).toBeNull()
    expect(s.plans[1].currency).toBe('CNY')
    expect(s.recharge).toMatchObject({ max: 0, multiplier: 2, feeRate: 1.5, bonusMode: 'discount', usdToCnyRate: 0 })
    // 没有 type 的支付方式丢掉，没有 label 用 type
    expect(s.methods).toEqual([
      { type: 'alipay', label: '支付宝' },
      { type: 'stripe', label: 'stripe' },
    ])
  })

  it('坏的套餐条目丢掉，不让整页失败', () => {
    const s = parseStore({
      ...open,
      plans: [
        null,
        'x',
        { id: '1', name: 'a', price: 1 },
        { id: 1, name: '', price: 1 },
        { id: 1, name: 'a', price: -1 },
        { id: 9, name: 'ok', price: '30' },
        { id: 5, name: 'ok', price: 5 },
      ],
    })
    expect(s.plans.map(p => p.id)).toEqual([5])
  })

  it('赠送档位：非法的丢掉，按金额升序；倍率非正数当 1；未知模式当 bonus', () => {
    const s = parseStore({
      ...open,
      recharge: {
        enabled: true,
        multiplier: 0,
        bonus_mode: 'weird',
        bonus_tiers: [
          { min_amount: 500, bonus_percent: 10 },
          { min_amount: 100, bonus_percent: 5 },
          { min_amount: 'x', bonus_percent: 5 },
          { min_amount: 1, bonus_percent: 0 },
          null,
        ],
      },
    })
    expect(s.recharge.bonusTiers).toEqual([
      { minAmount: 100, bonusPercent: 5 },
      { minAmount: 500, bonusPercent: 10 },
    ])
    expect(s.recharge.multiplier).toBe(1)
    expect(s.recharge.bonusMode).toBe('bonus')
  })

  it('缺 recharge 当作充值关闭', () => {
    const { recharge: _drop, ...rest } = open
    void _drop
    expect(parseStore(rest).recharge).toMatchObject({ enabled: false, min: 0, max: 0, multiplier: 1, feeRate: 0 })
  })

  it.each([null, 'x', [], {}, { enabled: 'yes', plans: [] }, { enabled: true }, { enabled: true, plans: {} }])(
    '整体不对就报错：%j',
    body => {
      expect(() => parseStore(body)).toThrow('服务返回的套餐数据异常')
    },
  )
})

describe('fetchStore', () => {
  it('502 带云端的提示，响应不是 JSON 也有兜底', async () => {
    mocks.response = { status: 502, body: { error: '暂时读不到' } }
    await expect(fetchStore()).rejects.toThrow('暂时读不到')
    mocks.response = { status: 500, body: null }
    await expect(fetchStore()).rejects.toThrow('HTTP 500')
  })
})

describe('storeLink / openStore', () => {
  it('只打开最近一次取到的目录里的 http(s) 地址', async () => {
    await expect(openStore('purchase')).rejects.toThrow('请先刷新')
    await fetchStore()
    await openStore('purchase')
    await openStore('redeem')
    expect(mocks.opened).toEqual(['https://panel.example.com/purchase', 'https://panel.example.com/redeem'])
  })

  it('购买页只允许带 tab=subscription 和正整数 group，其他参数一律不带', async () => {
    await fetchStore()
    await openStore('purchase', { tab: 'subscription', group: 7, amount: 100, url: 'https://evil.example' })
    await openStore('purchase', { tab: 'subscription', group: '7&x=1' })
    await openStore('purchase', { tab: 'subscription', group: -3 })
    await openStore('purchase', { tab: 'other', group: 7 })
    await openStore('redeem', { tab: 'subscription', group: 7 })
    expect(mocks.opened).toEqual([
      'https://panel.example.com/purchase?tab=subscription&group=7',
      'https://panel.example.com/purchase?tab=subscription',
      'https://panel.example.com/purchase?tab=subscription',
      'https://panel.example.com/purchase',
      'https://panel.example.com/redeem',
    ])
  })

  it('种类不对、登录的账号换了都拒绝', async () => {
    await fetchStore()
    await expect(openStore('https://evil.example')).rejects.toThrow('无效的面板页')
    mocks.email = 'bob@example.com'
    await expect(openStore('purchase')).rejects.toThrow('请先刷新')
    expect(mocks.opened).toEqual([])
  })

  it('不是 http(s) 绝对地址就不打开', () => {
    const catalog = parseStore(open)
    for (const bad of ['/purchase', '', 'javascript:alert(1)', 'file:///c:/x', 'ftp://x.example/purchase']) {
      expect(() => storeLink('purchase', { ...catalog, purchaseUrl: bad })).toThrow('没有可用的面板地址')
    }
    expect(storeLink('purchase', { ...catalog, purchaseUrl: 'http://127.0.0.1:9080/purchase' })).toBe(
      'http://127.0.0.1:9080/purchase',
    )
  })
})
