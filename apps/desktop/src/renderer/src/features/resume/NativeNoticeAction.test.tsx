// 接着终端里的会话：提示上的按钮（加载更早的、补上终端里新聊的 N 轮）
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
// 引擎的 store 在导入时读 window.pixelsky：先放一个带事件方法的空 window
vi.hoisted(() => {
  ;(globalThis as { window?: unknown }).window ??= {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
})
import { I18nProvider } from '@/i18n/I18nProvider'
import { NativeNoticeAction } from './NativeNoticeAction'

const render = (action: { kind: 'native-earlier' | 'native-sync'; count: number }): string =>
  renderToStaticMarkup(
    <I18nProvider>
      <NativeNoticeAction action={action} sessionId="s1" />
    </I18nProvider>,
  )

describe('NativeNoticeAction', () => {
  it('native-earlier 显示「加载更早的」', () => {
    const html = render({ kind: 'native-earlier', count: 70 })
    expect(html).toContain('data-native-action="native-earlier"')
    expect(html).toContain('加载更早的')
  })
  it('native-sync 显示「补上终端里新聊的 N 轮」', () => {
    const html = render({ kind: 'native-sync', count: 3 })
    expect(html).toContain('data-native-action="native-sync"')
    expect(html).toContain('补上终端里新聊的 3 轮')
  })
})
