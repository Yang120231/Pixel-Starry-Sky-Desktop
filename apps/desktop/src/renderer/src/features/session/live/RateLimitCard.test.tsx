import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { QueuedMessage } from '@pixelsky/protocol'
import { I18nProvider } from '@/i18n/I18nProvider'
import { setCurrentLocale } from '@/i18n/core'
import { RateLimitCard } from './RateLimitCard'

// 卡片连着引擎 bridge、设置和账号 store（它们导入时要 window）：静态渲染只看画面，这些都换成空的
vi.mock('@/data', () => ({ isDemo: false }))
vi.mock('@/features/engine', () => ({ bridge: undefined }))
vi.mock('@/features/engine/demoQueue', () => ({ demoLimitAction: () => {} }))
vi.mock('@/features/settings/SettingsProvider', () => ({ useSettings: () => ({ openSettings: () => {} }) }))
vi.mock('@/features/model-channels/accountsStore', () => ({ openAccountsPage: () => {} }))

beforeAll(() => setCurrentLocale('zh-CN'))

const wait = (over: Partial<QueuedMessage['limit']> = {}, at = Date.now() + 83 * 60_000 + 45_000): QueuedMessage => ({
  id: 'q',
  text: 'a',
  createdAt: 0,
  settings: { model: null, effort: null, platform: null },
  status: 'queued',
  error: null,
  mode: 'normal',
  limit: { kind: 'quota', window: 'five_hour', resetsAt: at - 5_000, tries: [], ...over },
  reconnect: { attempt: 1, max: 3, since: Date.now() - 20_000, at, reason: '', limited: true },
})
const html = (queue: QueuedMessage[], paused = false): string =>
  renderToStaticMarkup(
    <I18nProvider>
      <RateLimitCard sessionId="s" queue={queue} paused={paused} engine={undefined} />
    </I18nProvider>,
  )

describe('RateLimitCard', () => {
  it('没有等待项时什么都不画', () => {
    expect(html([])).toBe('')
  })

  it('倒计时中：标题、剩余时间、勾选框默认勾上、现在就试和取消等待', () => {
    const out = html([wait()])
    expect(out).toContain('data-limit-card="waiting"')
    expect(out).toContain('5 小时额度已用完')
    expect(out).toMatch(/data-limit-countdown[^>]*>1:2[0-3]:\d\d</)
    expect(out).toMatch(/data-limit-auto[^>]*checked/)
    expect(out).toContain('现在就试')
    expect(out).toContain('取消等待')
  })

  it('队列暂停（取消勾选 / 重启后）：勾选框不勾，标「已暂停」', () => {
    const out = html([wait()], true)
    expect(out).toContain('data-limit-card="paused"')
    expect(out).not.toMatch(/data-limit-auto[^>]*checked/)
    expect(out).toContain('已暂停')
  })

  it('只有 429：写请求太频繁和退避说明', () => {
    const out = html([wait({ kind: 'rate', window: null, resetsAt: null })])
    expect(out).toContain('请求太频繁（429）')
    expect(out).toContain('没有给出恢复时间')
  })

  it('连续 3 次仍被限流：停止卡片，列出三次时间，给手动重试', () => {
    const out = html([wait({ tries: [1, 2, 3].map(n => new Date(2026, 9, 25, 14, 30 + n).getTime()) })], true)
    expect(out).toContain('data-limit-card="stopped"')
    expect(out).toContain('role="alert"')
    expect(out).toContain('自动继续已停止')
    expect(out).toContain('14:31 被限流')
    expect(out).toContain('14:33 被限流')
    expect(out).toContain('手动重试')
    expect(out).not.toContain('data-limit-auto')
  })
})
