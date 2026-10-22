// 订阅额度都用完、自动改用了平台的提示条（docs/ui/engine-accounts.md §5.2）：文字按 notice.fallback 拼（界面语言），
// 下面「换回订阅」「关闭自动改用平台」跟着会话现在的来源和设置变——提示一直留在记录里，不能永远可点
import { Fragment, useEffect, useState } from 'react'
import type { NoticePlatformFallback } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { useSettings } from '@/features/settings/SettingsProvider'
import { bridge, useEngineState } from '@/features/engine/store'
import { resetClock, resetShort } from '@/features/session/quota/quotaModel'
import { openAccountsPage, setAccountAuto, useAccounts } from './accountsStore'

/** 提示文字：「X 的 5 小时订阅额度用完了，已改用平台（线路 · 模型）继续。16:45 恢复」；换回了订阅是另一句 */
export function fallbackNoticeText(f: NoticePlatformFallback, now: number): string {
  if (f.kind === 'back') return tr('accounts.fallback.back', { from: f.fromName })
  const window =
    f.window === 'five_hour'
      ? tr('accounts.notice.fiveHour')
      : f.window === 'seven_day'
        ? tr('accounts.notice.week')
        : null
  const text = window
    ? tr('accounts.fallback.usedWindow', { from: f.fromName, window, group: f.group, model: f.model })
    : tr('accounts.fallback.used', { from: f.fromName, group: f.group, model: f.model })
  return f.resetsAt !== null && f.resetsAt > now
    ? tr('accounts.notice.withReset', { text, reset: resetShort(f.resetsAt, now) })
    : text
}

const link = 'press text-accent-fg hover:underline disabled:cursor-default disabled:text-fg-faint disabled:no-underline'

/**
 * 按钮（只在改用平台的那条下面有）：
 * - 会话还在用改过去的平台（platformFallback 还在）→ 「换回订阅」，订阅没到恢复时间时灰掉；
 *   已经回到订阅 → 灰字「已换回订阅」；自己换了别的来源 → 不显示
 * - 自动改用平台开着 → 「关闭自动改用平台」；关了 → 灰字「已关闭自动改用平台」+「设置」
 */
export function PlatformFallbackNoticeActions({
  fallback,
  sessionId,
  onError,
}: {
  fallback: NoticePlatformFallback
  sessionId: string | null | undefined
  onError: (message: string | null) => void
}) {
  useI18n()
  const settings = useSettings()
  const list = useAccounts(fallback.engine)
  const record = useEngineState(s => (sessionId ? (s.snapshots[sessionId]?.record ?? null) : null))
  const [now, setNow] = useState(() => Date.now())
  const [acting, setActing] = useState(false)
  // 到了恢复时间「换回订阅」变成可点
  useEffect(() => {
    const at = fallback.resetsAt
    if (at === null || at <= now) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(at - now + 500, 2 ** 31 - 1))
    return () => window.clearTimeout(timer)
  }, [fallback.resetsAt, now])
  if (fallback.kind !== 'platform' || !list) return null
  const run = (fn: () => Promise<unknown>): void => {
    setActing(true)
    onError(null)
    fn()
      .catch((e: unknown) => onError((e as Error).message))
      .finally(() => setActing(false))
  }
  const onPlatform = !!record?.platform && !!record.platformFallback
  const own = !!record && !record.platform && !record.provider
  const waiting = fallback.resetsAt !== null && now < fallback.resetsAt
  const parts: React.ReactNode[] = []
  if (onPlatform && sessionId && bridge)
    parts.push(
      <button
        key="back"
        type="button"
        data-fallback-notice-back
        disabled={acting || waiting}
        title={
          waiting && fallback.resetsAt !== null
            ? tr('accounts.fallback.backWait', { time: resetClock(fallback.resetsAt, now) })
            : undefined
        }
        onClick={() =>
          run(() => bridge!.updateSession(sessionId, { platform: null, provider: null, model: fallback.selfModel }))
        }
        className={link}
      >
        {tr('accounts.fallback.switchBack')}
      </button>,
    )
  else if (own)
    parts.push(
      <span key="back" className="text-fg-faint">
        {tr('accounts.fallback.switchedBack')}
      </span>,
    )
  if (list.auto.platform)
    parts.push(
      <button
        key="auto"
        type="button"
        data-fallback-notice-auto
        disabled={acting}
        onClick={() => run(() => setAccountAuto(fallback.engine, { platform: false }))}
        className={link}
      >
        {tr('accounts.fallback.autoOff')}
      </button>,
    )
  else
    parts.push(
      <span key="auto" className="text-fg-faint">
        {tr('accounts.fallback.autoIsOff')}
      </span>,
      <button
        key="settings"
        type="button"
        onClick={() => {
          openAccountsPage(fallback.engine === 'claude' ? 'claude' : 'chatgpt')
          settings.openSettings('models')
        }}
        className={link}
      >
        {tr('accounts.notice.settings')}
      </button>,
    )
  return (
    <span data-fallback-notice className="flex flex-wrap items-center gap-x-1.5 text-meta">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span aria-hidden className="text-fg-faint">
              ·
            </span>
          )}
          {p}
        </Fragment>
      ))}
    </span>
  )
}
