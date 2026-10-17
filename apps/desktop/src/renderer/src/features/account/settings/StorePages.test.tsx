import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@/i18n/I18nProvider'
import { setCurrentLocale } from '@/i18n/core'
import type { AccountInfo, StoreCatalog } from '../../../../../shared/types/account'
import { PlanStore } from './PlanStore'
import { StorePages } from './StorePages'
import { AccountCheckNotice, PaymentOutcome, StoreHeader, changeLines } from './StoreParts'
import { TopUp } from './TopUp'

// 订阅套餐 / 充值页：账号核对提示、余额与套餐头部、到账反馈、预计应付（用静态渲染，不依赖 DOM）。

const account: AccountInfo = {
  email: 'alice@example.com',
  name: 'Alice',
  balance: 12.5,
  currency: 'USD',
  group: null,
  plan: { name: 'Pro 月卡', expiresAt: '2026-11-01T12:00:00Z', daily: null, weekly: null, monthly: null },
  rateLimits: [],
  updatedAt: 1,
}

const catalog = (over: Partial<StoreCatalog> = {}): StoreCatalog => ({
  enabled: true,
  currency: 'CNY',
  currencyKnown: true,
  plans: [],
  recharge: {
    enabled: true,
    min: 5,
    max: 1000,
    multiplier: 1,
    feeRate: 2,
    bonusMode: 'bonus',
    bonusTiers: [{ minAmount: 100, bonusPercent: 10 }],
    usdToCnyRate: 7,
  },
  methods: [{ type: 'alipay', label: '支付宝' }],
  helpText: '',
  purchaseUrl: 'https://pixelstarrysky.xyz/purchase',
  redeemUrl: 'https://pixelstarrysky.xyz/redeem',
  ...over,
})

afterEach(() => {
  vi.unstubAllGlobals()
  setCurrentLocale('zh-CN')
})

function render(node: React.ReactElement, locale: 'zh-CN' | 'en-US' = 'zh-CN'): string {
  vi.stubGlobal('localStorage', { getItem: () => locale, setItem: () => undefined })
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>)
}

describe('StorePages 顶部', () => {
  const refresh = async () => ({ error: null, account })
  it('打开支付页之前就显示「请确认浏览器里面板登录的是 邮箱」，并显示余额、套餐和到期时间', () => {
    const html = render(<StorePages tab="topup" account={account} onRefreshAccount={refresh} />)
    expect(html).toContain('请确认浏览器里面板登录的是 alice@example.com')
    expect(html).toContain('当前余额 $12.50')
    expect(html).toContain('套餐 Pro 月卡')
    expect(html).toMatch(/到期 2026-1[01]-\d\d/)
    expect(html).not.toContain('我已付款')
  })
  it('英文界面：账号核对提示和头部都是英文', () => {
    const html = render(
      <StorePages tab="plans" account={{ ...account, plan: null }} onRefreshAccount={refresh} />,
      'en-US',
    )
    expect(html).toContain('Make sure the panel in your browser is signed in as alice@example.com')
    expect(html).toContain('Balance $12.50')
    expect(html).toContain('No plan')
    expect(html).not.toMatch(/[一-鿿]/)
  })
  it('AccountCheckNotice 是 note 角色', () => {
    expect(render(<AccountCheckNotice email="a@b.c" />)).toContain('role="note"')
  })
  it('StoreHeader：没有套餐时写「暂无套餐」', () => {
    expect(render(<StoreHeader account={{ ...account, plan: null, balance: null }} />)).toContain('暂无套餐')
  })
})

describe('到账反馈', () => {
  it('到账：余额和套餐的前后对比', () => {
    const lines = changeLines({ balance: { from: 10, to: 35 }, plan: { from: null, to: 'Pro' }, expires: null }, 'USD')
    expect(lines).toEqual(['余额 $10.00 → $35.00', '套餐 无 → Pro'])
    const html = render(
      <PaymentOutcome
        outcome={{ kind: 'arrived', change: { balance: { from: 10, to: 35 }, plan: null, expires: null } }}
        currency="USD"
      />,
    )
    expect(html).toContain('已到账')
    expect(html).toContain('余额 $10.00 → $35.00')
  })
  it('续费：到期时间对比', () => {
    const lines = changeLines({ balance: null, plan: null, expires: { from: '2026-11-01T12:00:00Z', to: null } }, 'USD')
    expect(lines[0]).toMatch(/^到期时间 2026-1[01]-\d\d → 无$/)
  })
  it('暂未到账的提示（中英文）', () => {
    const zh = render(<PaymentOutcome outcome={{ kind: 'pending' }} currency="USD" />)
    expect(zh).toContain('暂未到账：可能有几秒延迟；如果一直没到，请到面板确认登录的账号和订单')
    const en = render(<PaymentOutcome outcome={{ kind: 'pending' }} currency="USD" />, 'en-US')
    expect(en).toContain('Not received yet')
  })
})

describe('TopUp 预计应付', () => {
  const onOpen = vi.fn()
  it('可信币种：标签是「预计应付」，含手续费，旁边写明要在面板重新输入金额并可复制', () => {
    const html = render(<TopUp catalog={catalog()} currency="USD" onOpen={onOpen} initialAmount="100" />)
    expect(html).toContain('预计应付')
    expect(html).not.toMatch(/>应付</)
    expect(html).toContain('¥102') // 100 + 2% 手续费
    expect(html).toContain('含手续费 ¥2')
    expect(html).toContain('需在面板里重新输入金额')
    expect(html).toContain('复制金额')
  })
  it('赠送额度的括号放进文案：中文全角、英文半角', () => {
    const zh = render(<TopUp catalog={catalog()} currency="USD" onOpen={onOpen} initialAmount="100" />)
    expect(zh).toContain('（含赠送 $10）')
    const en = render(<TopUp catalog={catalog()} currency="USD" onOpen={onOpen} initialAmount="100" />, 'en-US')
    expect(en).toContain('(incl. $10 bonus)')
    expect(en).not.toContain('）')
    expect(en).toContain('Estimated amount due')
  })
  it('套餐币种和支付币种对不上：不显示应付金额，提示以面板为准', () => {
    const mixed = catalog({
      plans: [{ id: 1, name: 'A', currency: 'USD' } as never],
    })
    const html = render(<TopUp catalog={mixed} currency="USD" onOpen={onOpen} initialAmount="100" />)
    expect(html).not.toContain('¥102')
    expect(html).toContain('支付币种无法确认，请以面板显示的金额为准')
    // 到账额度不受影响
    expect(html).toContain('$110')
  })
  it('云端没给币种（默认值是猜的）：同样不显示', () => {
    const html = render(
      <TopUp catalog={catalog({ currencyKnown: false })} currency="USD" onOpen={onOpen} initialAmount="100" />,
    )
    expect(html).not.toContain('¥102')
    expect(html).toContain('支付币种无法确认')
  })
  it('没输入金额：应付显示「—」，没有币种提示，复制按钮不可点', () => {
    const html = render(<TopUp catalog={catalog()} currency="USD" onOpen={onOpen} />)
    expect(html).not.toContain('支付币种无法确认')
    expect(html).toMatch(/disabled=""[^>]*>[^<]*(<svg[^>]*>.*?<\/svg>)?[^<]*复制金额/s)
  })
})

describe('PlanStore', () => {
  it('没有在售套餐时仍给出打开面板的入口', () => {
    expect(render(<PlanStore catalog={catalog()} currentPlan={null} onOpen={vi.fn()} />)).toContain('打开网页面板')
  })
})
