import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@/i18n/I18nProvider'
import { setCurrentLocale } from '@/i18n/core'
import { QuotaDisplayRow } from './QuotaDisplaySettings'
import { DEFAULT_QUOTA_DISPLAY, type QuotaDisplay } from './quotaDisplay'

// 设置那一行（静态渲染）：打开时两个选项 + 预览，关掉时只有提示。

const NOW = new Date(2026, 9, 19, 14, 32).getTime()

afterEach(() => {
  vi.unstubAllGlobals()
  setCurrentLocale('zh-CN')
})

function render(display: QuotaDisplay, locale: 'zh-CN' | 'en-US' = 'zh-CN'): string {
  vi.stubGlobal('localStorage', { getItem: () => locale, setItem: () => undefined })
  setCurrentLocale(locale)
  return renderToStaticMarkup(
    <I18nProvider>
      <QuotaDisplayRow display={display} onChange={() => undefined} now={NOW} />
    </I18nProvider>,
  )
}

describe('输入框显示账号额度（设置）', () => {
  it('打开（默认）：开关、什么时候显示、按钮样式、预览', () => {
    const html = render(DEFAULT_QUOTA_DISPLAY)
    expect(html).toContain('data-setting-title="输入框显示账号额度"')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-label="输入框显示账号额度"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('aria-label="什么时候显示"')
    expect(html).toContain('>一直显示<')
    expect(html).toContain('>快用完时才显示<')
    expect(html).toContain('aria-label="按钮样式"')
    expect(html).toContain('>图标和百分比<')
    expect(html).toContain('>只有图标<')
    expect(html).toContain('预览（示例数据）')
    expect(html).not.toContain('已隐藏')
  })
  it('选中的选项 aria-checked', () => {
    const html = render({ enabled: true, when: 'near-limit', style: 'icon' })
    expect(html).toMatch(/aria-checked="true"[^>]*>(?:(?!<\/button>).)*快用完时才显示/s)
    expect(html).toMatch(/aria-checked="true"[^>]*>(?:(?!<\/button>).)*只有图标/s)
  })
  it('预览跟着选项变：默认是「周 61%」，快用完时才显示是橙色「5h 86%」，只有图标没有文字', () => {
    const normal = render(DEFAULT_QUOTA_DISPLAY)
    expect(normal).toContain('data-quota-label')
    expect(normal).toContain('>61%<')
    const near = render({ ...DEFAULT_QUOTA_DISPLAY, when: 'near-limit' })
    expect(near).toContain('>86%<')
    expect(near).toContain('text-warn')
    expect(near).toContain('任一项到 80% 才会出现')
    const icon = render({ ...DEFAULT_QUOTA_DISPLAY, style: 'icon' })
    expect(icon).not.toContain('data-quota-label')
    expect(icon).toContain('data-quota-trigger')
  })
  it('预览里的按钮不可点、不进 Tab 顺序', () => {
    const html = render(DEFAULT_QUOTA_DISPLAY)
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('pointer-events-none')
  })
  it('关掉：没有选项和预览，只有提示', () => {
    const html = render({ ...DEFAULT_QUOTA_DISPLAY, enabled: false })
    expect(html).toContain('aria-checked="false"')
    expect(html).not.toContain('role="radiogroup"')
    expect(html).not.toContain('预览（示例数据）')
    expect(html).toContain(
      '已隐藏：输入框里不显示额度按钮，模型通道菜单里的额度简写也不显示。额度用完时，对话里照样会报错提示。',
    )
  })
  it('英文界面', () => {
    const html = render(DEFAULT_QUOTA_DISPLAY, 'en-US')
    expect(html).toContain('data-setting-title="Show account usage in the input"')
    expect(html).toContain('>Always<')
    expect(html).toContain('>Only when nearly used up<')
    expect(html).toContain('>Icon and percentage<')
    expect(html).toContain('Preview (sample data)')
  })
})
