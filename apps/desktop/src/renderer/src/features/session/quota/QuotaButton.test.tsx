import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderToStaticMarkup } from 'react-dom/server'
import { quotaWindowId, type AccountQuota, type QuotaWindow } from '@pixelsky/protocol'
import { I18nProvider } from '@/i18n/I18nProvider'
import { setCurrentLocale } from '@/i18n/core'
import type { QuotaButtonStyle } from '@/features/settings/quotaDisplay'
import { QuotaTrigger } from './QuotaTrigger'
import { quotaButtonView } from './quotaModel'

// 按钮本体的显示（静态渲染）：文字、颜色、只有图标、读取中 / 失败的空条、英文界面。
// 显示条件（设置、机器、通道、模式）见 quotaModel.test.ts 的 quotaTarget / quotaButtonVisible。

const NOW = new Date(2026, 9, 19, 14, 32).getTime()

afterEach(() => {
  vi.unstubAllGlobals()
  setCurrentLocale('zh-CN')
})

const win = (durationMins: number, usedPercent: number): QuotaWindow => ({
  id: quotaWindowId(durationMins),
  durationMins,
  usedPercent,
  resetsAt: null,
})

const quota = (windows: QuotaWindow[], over: Partial<AccountQuota> = {}): AccountQuota => ({
  provider: 'claude',
  status: 'ok',
  plan: 'max',
  account: null,
  windows,
  extras: {},
  blocked: null,
  observedAt: null,
  fetchedAt: null,
  source: 'usage',
  refreshable: true,
  error: null,
  ...over,
})

function render(
  q: AccountQuota | null,
  opts: { loading?: boolean; style?: QuotaButtonStyle; open?: boolean; locale?: 'zh-CN' | 'en-US' } = {},
): string {
  vi.stubGlobal('localStorage', { getItem: () => opts.locale ?? 'zh-CN', setItem: () => undefined })
  setCurrentLocale(opts.locale ?? 'zh-CN') // 视图在 Provider 外面算，语言要先设好
  const view = quotaButtonView(q, { provider: 'claude', loading: !!opts.loading, now: NOW })
  return renderToStaticMarkup(
    <I18nProvider>
      <QuotaTrigger view={view} style={opts.style} open={opts.open} />
    </I18nProvider>,
  )
}

const rects = (html: string): number => (html.match(/<rect /g) ?? []).length
const label = (html: string): string =>
  /data-quota-label[^>]*>(.*?)<\/span><\/button>/s
    .exec(html)?.[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() ?? ''

describe('额度按钮', () => {
  it('正常：两根条 + 简称和百分比，属性齐全', () => {
    const html = render(quota([win(300, 42), win(10_080, 61)]))
    expect(html).toContain('data-quota-trigger')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="Claude 账号额度：5 小时内已用 42%，本周已用 61%"')
    expect(html).toContain('title="Claude 账号额度（Max）')
    expect(html).toContain('text-fg-muted')
    expect(label(html)).toBe('周 61%')
    expect(rects(html)).toBe(4)
  })
  it('弹窗开着：aria-expanded=true', () => {
    expect(render(quota([win(300, 42)]), { open: true })).toContain('aria-expanded="true"')
  })
  it('橙：文字和条都变橙', () => {
    const html = render(quota([win(300, 86), win(10_080, 39)]))
    expect(html).toContain('text-warn')
    expect(html).toContain('fill="var(--warn)"')
    expect(label(html)).toBe('5h 86%')
  })
  it('红：用完写文字，不只靠颜色', () => {
    const html = render(quota([win(300, 12), win(10_080, 100)]))
    expect(html).toContain('text-danger')
    expect(html).toContain('fill="var(--danger)"')
    expect(label(html)).toBe('本周已用完')
  })
  it('只有图标：没有文字，悬停和 aria-label 照旧', () => {
    const html = render(quota([win(300, 42), win(10_080, 61)]), { style: 'icon' })
    expect(html).not.toContain('data-quota-label')
    expect(html).toContain('aria-label="Claude 账号额度：5 小时内已用 42%')
  })
  it('读取中：两根空条、没有文字', () => {
    const html = render(null, { loading: true })
    expect(html).not.toContain('data-quota-label')
    expect(html).toContain('aria-label="Claude 账号额度：正在读取"')
    expect(rects(html)).toBe(2)
    expect(html).not.toContain('fill="var(--accent)"')
  })
  it('失败：只有图标', () => {
    const html = render(quota([win(300, 42)], { status: 'error' }))
    expect(html).not.toContain('data-quota-label')
    expect(html).toContain('aria-label="Claude 账号额度：读取失败"')
    expect(rects(html)).toBe(2)
  })
  it('只有点数：一根空条 + 「点数 2,480」', () => {
    const html = render(
      quota([], { provider: 'chatgpt', extras: { credits: { hasCredits: true, unlimited: false, balance: 2480 } } }),
    )
    expect(label(html)).toBe('点数 2,480')
    expect(rects(html)).toBe(1)
  })
  it('英文界面', () => {
    const html = render(quota([win(300, 42), win(10_080, 61)]), { locale: 'en-US' })
    expect(html).toContain('aria-label="Claude usage limits: 5-hour limit: 42% used, Weekly limit: 61% used"')
    expect(label(html)).toBe('Wk 61%')
    expect(html).toContain('title="Claude usage limits (Max)')
  })
})
