import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n/I18nProvider'
import type { SessionPr } from '../../../../shared/types/session-status'
import { InlinePr, SessionMarks, SessionStatusMark, StatusGlyph, StatusLabel, prIcon } from './SessionMarks'
import { statusOf, type StatusKind } from './sessionStatusModel'

const pr = (extra: Partial<SessionPr> = {}): SessionPr => ({
  repo: 'o/r',
  number: 1,
  url: 'u',
  title: 't',
  state: 'open',
  ci: 'pass',
  ciFailed: 0,
  conflict: false,
  additions: 0,
  deletions: 0,
  head: 'a',
  base: 'main',
  closedAt: null,
  ...extra,
})
const html = (node: React.ReactElement): string => renderToStaticMarkup(node)

/** 每个 kind 对应的 lucide 图标类名（lucide-react 给 svg 加 lucide-<name>） */
const ICON_CLASS: Partial<Record<StatusKind, string>> = {
  approve: 'lucide-hand',
  question: 'lucide-message-circle-question-mark',
  auth: 'lucide-key-round',
  balance: 'lucide-wallet',
  route: 'lucide-route-off',
  busy: 'lucide-hourglass',
  failed: 'lucide-triangle-alert',
  folder: 'lucide-folder-x',
  offline: 'lucide-cloud-off',
  paused: 'lucide-circle-pause',
  'pr-conflict': 'lucide-git-merge-conflict',
}

describe('StatusGlyph', () => {
  it('每一种问题一个图标，15px、线宽 1.5', () => {
    for (const [kind, cls] of Object.entries(ICON_CLASS)) {
      const out = html(
        <StatusGlyph kind={kind as StatusKind} pr={kind === 'pr-conflict' ? pr({ conflict: true }) : null} />,
      )
      expect(out, kind).toContain(cls)
      expect(out, kind).toContain('width="15"')
      expect(out, kind).toContain('stroke-width="1.5"')
    }
  })

  it('颜色：等你 / 繁忙 / 连不上黄，出错类红，暂停灰', () => {
    expect(html(<StatusGlyph kind="approve" />)).toContain('text-warn')
    expect(html(<StatusGlyph kind="busy" />)).toContain('text-warn')
    expect(html(<StatusGlyph kind="offline" />)).toContain('text-warn')
    expect(html(<StatusGlyph kind="auth" />)).toContain('text-danger')
    expect(html(<StatusGlyph kind="folder" />)).toContain('text-danger')
    expect(html(<StatusGlyph kind="paused" />)).toContain('text-fg-faint')
  })

  it('PR 按状态：开着绿、草稿灰、已合并紫、已关闭红、查不到灰', () => {
    const state = (extra: Partial<SessionPr>) => html(<StatusGlyph kind="pr" pr={pr(extra)} />)
    expect(state({})).toContain('lucide-git-pull-request')
    expect(state({})).toContain('text-success')
    expect(state({ state: 'draft' })).toContain('lucide-git-pull-request-draft')
    expect(state({ state: 'draft' })).toContain('text-fg-faint')
    expect(state({ state: 'merged' })).toContain('lucide-git-merge')
    expect(state({ state: 'merged' })).toContain('text-status-working')
    expect(state({ state: 'closed' })).toContain('lucide-git-pull-request-closed')
    expect(state({ state: 'closed' })).toContain('text-danger')
    expect(state({ unknown: true })).toContain('text-fg-faint')
    expect(prIcon(null).tone).toBe('text-fg-faint')
  })

  it('检查没过的开着的 PR 右下角有 6px 红点，通过 / 进行中 / 没检查 / 已合并没有', () => {
    const dot = (extra: Partial<SessionPr>) => html(<StatusGlyph kind="pr" pr={pr(extra)} ring="ring-selected" />)
    expect(dot({ ci: 'fail', ciFailed: 1 })).toContain('data-ci-fail')
    expect(dot({ ci: 'fail', ciFailed: 1 })).toContain('size-1.5')
    expect(dot({ ci: 'fail', ciFailed: 1 })).toContain('ring-selected')
    expect(dot({ ci: 'pass' })).not.toContain('data-ci-fail')
    expect(dot({ ci: 'pending' })).not.toContain('data-ci-fail')
    expect(dot({ ci: null })).not.toContain('data-ci-fail')
    expect(dot({ ci: 'fail', state: 'merged' })).not.toContain('data-ci-fail')
    // 有冲突又检查没过：冲突图标上也有红点
    const both = html(<StatusGlyph kind="pr-conflict" pr={pr({ conflict: true, ci: 'fail' })} />)
    expect(both).toContain('lucide-git-merge-conflict')
    expect(both).toContain('data-ci-fail')
  })

  it('在跑是转圈，新回复是主色点，都不是 lucide 图标', () => {
    expect(
      html(
        <I18nProvider>
          <StatusGlyph kind="running" />
        </I18nProvider>,
      ),
    ).not.toContain('lucide')
    expect(
      html(
        <I18nProvider>
          <StatusGlyph kind="unread" />
        </I18nProvider>,
      ),
    ).not.toContain('lucide')
  })
})

describe('SessionStatusMark', () => {
  it('带 data-session-mark，值是 kind；没有状态不画', () => {
    const status = statusOf({ running: false, unread: false, folderMissing: true })
    expect(html(<SessionStatusMark status={status} />)).toContain('data-session-mark="folder"')
    expect(html(<SessionStatusMark status={statusOf({ running: false, unread: false })} />)).toBe('')
  })
})

describe('右边的字和小 PR 图标', () => {
  it('问题类的字代替时间；PR 被占了时小图标在字前面（13px）', () => {
    const status = statusOf({ running: false, unread: false, folderMissing: true, prs: [pr({ state: 'merged' })] })
    const out = html(<StatusLabel status={status} />)
    expect(out).toContain('文件夹没了')
    expect(out).toContain('data-session-pr="merged"')
    expect(out).toContain('width="13"')
    expect(out.indexOf('data-session-pr')).toBeLessThan(out.indexOf('文件夹没了'))
  })

  it('置顶行的字前面带问题图标', () => {
    const status = statusOf({
      card: { lane: 'failed', request: null, error: '登录已失效' },
      running: false,
      unread: false,
    })
    const out = html(<StatusLabel status={status} icon />)
    expect(out).toContain('lucide-key-round')
    expect(out).toContain('要登录')
  })

  it('没有问题时 SessionMarks 写时间，被占着有 PR 时时间前面有小图标', () => {
    const plain = html(<SessionMarks running={false} unread={false} time="3天" />)
    expect(plain).toContain('3天')
    expect(plain).not.toContain('data-session-pr')
    const busy = statusOf({ running: true, unread: false, prs: [pr()] })
    const out = html(<SessionMarks running unread={false} time="刚刚" status={busy} />)
    expect(out.indexOf('data-session-pr')).toBeLessThan(out.indexOf('刚刚'))
    // 格子里已经是 PR 时右边不再放
    const left = statusOf({ running: false, unread: false, prs: [pr()] })
    const none = html(<SessionMarks running={false} unread={false} time="刚刚" status={left} />)
    expect(none).not.toContain('data-session-pr')
  })

  it('InlinePr 开着有冲突用冲突图标', () => {
    expect(html(<InlinePr pr={pr({ conflict: true })} />)).toContain('lucide-git-merge-conflict')
  })
})
