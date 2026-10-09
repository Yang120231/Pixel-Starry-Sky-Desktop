import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
// 输入框上方的额度来源提示条（docs/ui/source-switch.md §3.4、§3.5）：
// - 已开始的会话切换平台 / 自有前的确认（会重启引擎并接上原对话）；
// - 发送前就知道会失败的情况 + 一键按钮。平台失败从不自动改用自有，按钮让用户自己选。
import { useState, type ReactNode } from 'react'
import { ArrowLeftRight, CircleAlert, TriangleAlert } from 'lucide-react'
import { Spinner, cn } from '@/components/ui'
import { useAccount } from '@/account/useAccount'
import { refreshPlatform, usePlatform, type CreditSource } from '@/account/platform'
import { useSettings } from '@/settings/SettingsProvider'
import type { ComposerController } from '@/engine'

function Action({ onClick, children, primary }: { onClick: () => void; children: ReactNode; primary?: boolean }) {
  useI18n()
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'press h-7 shrink-0 rounded-md px-2.5 text-meta',
        primary ? 'bg-primary text-primary-fg hover:opacity-90' : 'text-fg-secondary hover:bg-hover hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

function Bar({ tone, icon, children, actions }: { tone: 'warn' | 'danger' | 'info'; icon: ReactNode; children: ReactNode; actions: ReactNode }) {
  useI18n()
  return (
    <div
      role={tone === 'info' ? undefined : 'alert'}
      className={cn(
        'mx-3 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-1.5',
        tone === 'danger' ? 'border-danger/30 bg-danger/5' : tone === 'warn' ? 'border-warn/30 bg-warn/5' : 'border-line bg-subtle',
      )}
    >
      <span className={cn('flex shrink-0', tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-fg-muted')}>{icon}</span>
      <div className="min-w-0 flex-1 text-meta text-fg-secondary">{children}</div>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  )
}

export function SourceHintBar({
  live,
  confirm,
  onCancelConfirm,
  onRequestSource,
  onOpenMenu,
}: {
  live: ComposerController
  /** 等用户确认的切换目标；null 表示没有在确认 */
  confirm: CreditSource | null
  onCancelConfirm: () => void
  onRequestSource: (source: CreditSource) => void
  onOpenMenu: () => void
}) {
  useI18n()
  const account = useAccount()
  const platform = usePlatform()
  const settings = useSettings()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (confirm) {
    const engineName = live.engine?.name ?? 'Claude Code'
    const route = platform.groups.find((g) => g.id === (live.groupId ?? platform.groupId))
    const apply = (): void => {
      setBusy(true)
      setError(null)
      live
        .setSource(confirm)
        .then(onCancelConfirm)
        .catch((e: unknown) => setError((e as Error).message))
        .finally(() => setBusy(false))
    }
    return (
      <Bar
        tone="info"
        icon={<ArrowLeftRight size={14} />}
        actions={
          <>
            <Action onClick={onCancelConfirm}>{tr("account.AccountMenu.message31")}</Action>
            <Action primary onClick={apply}>
              {busy ? <Spinner /> : tr("session.SourceHintBar.message356", { p0: confirm === 'self' ? '自有' : '平台' })}
            </Action>
          </>
        }
      >
        <div className="font-medium text-fg">{tr("session.SourceHintBar.message357")}{confirm === 'self' ? tr("session.ModelSourceMenu.message280") : tr("session.ModelSourceMenu.message279")}{tr("session.SourceHintBar.message358")}</div>
        <div>
          {confirm === 'self'
            ? tr("session.SourceHintBar.message359", { p0: engineName })
            : tr("session.SourceHintBar.message360", { p0: route ? `线路「${route.name}」` : '' })}{tr("session.SourceHintBar.message362")} </div>
        {error && <div className="text-danger">{translateMessage(error)}</div>}
      </Bar>
    )
  }

  const b = live.blocker
  if (!b || live.running) return null
  const useSelf = <Action onClick={() => onRequestSource('self')}>{live.started ? tr("session.live.NoticeActions.message265") : tr("session.SourceHintBar.message363")}</Action>
  const usePlatformBtn = live.platformAvailable ? (
    <Action onClick={() => onRequestSource('platform')}>{live.started ? tr("session.live.NoticeActions.message266") : tr("session.SourceHintBar.message364")}</Action>
  ) : null

  switch (b.kind) {
    case 'signin':
      return (
        <Bar tone="warn" icon={<TriangleAlert size={14} />} actions={<>{useSelf}<Action primary onClick={() => void account.login()}>{tr("account.AccountMenu.message28")}</Action></>}>{tr("session.SourceHintBar.message365")} </Bar>
      )
    case 'account':
      return (
        <Bar tone="warn" icon={<TriangleAlert size={14} />} actions={useSelf}>{tr("session.SourceHintBar.message366")} {b.account}{tr("session.SourceHintBar.message367")} </Bar>
      )
    case 'no-route':
      return (
        <Bar
          tone="danger"
          icon={<CircleAlert size={14} />}
          actions={
            <>
              {useSelf}
              {b.balance && <Action onClick={() => settings.openSettings('account')}>{tr("session.live.NoticeActions.message267")}</Action>}
              <Action onClick={() => void refreshPlatform()}>{tr("session.ModelSourceMenu.message308")}</Action>
            </>
          }
        >
          {translateMessage(b.message)}
        </Bar>
      )
    case 'balance':
      return (
        <Bar
          tone="warn"
          icon={<TriangleAlert size={14} />}
          actions={
            <>
              {useSelf}
              <Action onClick={onOpenMenu}>{tr("session.live.NoticeActions.message264")}</Action>
              <Action onClick={() => settings.openSettings('account')}>{tr("session.live.NoticeActions.message267")}</Action>
            </>
          }
        >{tr("session.SourceHintBar.message368")} </Bar>
      )
    case 'self-auth':
    case 'self-missing':
      return (
        <Bar tone="warn" icon={<TriangleAlert size={14} />} actions={<>{usePlatformBtn}<Action onClick={live.redetect}>{tr("session.SourceHintBar.message369")}</Action></>}>
          <span className="selectable">{translateMessage(b.message)}</span>
        </Bar>
      )
  }
}
