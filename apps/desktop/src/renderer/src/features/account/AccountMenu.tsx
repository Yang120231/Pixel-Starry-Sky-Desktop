import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useEffect, useState } from 'react'
import { LogOut, RefreshCw, Settings2 } from 'lucide-react'
import { Button, Popover, PopoverItem, Spinner, cn } from '@/ui'
import { useAccount } from '@/features/account/useAccount'
import { useSettings } from '@/features/settings/SettingsProvider'
import { formatDate, formatUpdatedAt, formatWindow } from '@/features/account/format'
import type { Quota } from '../../../../shared/types/account'
import { LogoutConfirm } from './LogoutConfirm'
import { QuotaBar } from './QuotaBar'

interface AccountMenuProps {
  open: boolean
  onClose: () => void
  /** 弹出位置类名，例如 "bottom-full left-0 mb-2"。父元素需要 relative */
  className?: string
}

/** 账号菜单：未登录 / 登录中 / 已登录（余额、套餐、额度）。规格见 docs/ui/account.md §4.4 */
export function AccountMenu({ open, onClose, className }: AccountMenuProps) {
  useI18n()
  const acc = useAccount()
  const settings = useSettings()
  return (
    <Popover open={open} onClose={onClose} className={cn('w-72', className)}>
      {acc.status === 'loading' && (
        <div className="flex items-center gap-2 px-3 py-3 text-ui text-fg-muted">
          <Spinner />
          {tr('account.AccountMenu.loadingAccount')}{' '}
        </div>
      )}

      {acc.status === 'signed-out' && (
        <div className="flex flex-col gap-3 p-3">
          {acc.error && (
            <p role="alert" className="text-meta text-danger">
              {translateMessage(acc.error)}
            </p>
          )}
          <div>
            <div className="text-ui font-medium text-fg">{tr('account.AccountMenu.signInToPixel')}</div>
            <p className="mt-1 text-meta text-fg-muted">{tr('account.AccountMenu.signInToAccess')}</p>
          </div>
          <Button variant="primary" className="w-full justify-center" onClick={() => void acc.login()}>
            {tr('account.AccountMenu.signIn')}{' '}
          </Button>
        </div>
      )}

      {acc.status === 'signing-in' && (
        <div className="flex flex-col gap-3 p-3">
          <div className="flex items-start gap-2">
            <Spinner className="mt-0.5" />
            <div>
              <div className="text-ui font-medium text-fg">{tr('account.AccountMenu.waitingForAuthorization')}</div>
              <p className="mt-1 text-meta text-fg-muted">{tr('account.AccountMenu.authorizationPageIsOpen')}</p>
            </div>
          </div>
          <Button variant="outline" className="w-full justify-center" onClick={() => void acc.cancelLogin()}>
            {tr('account.AccountMenu.cancel')}{' '}
          </Button>
        </div>
      )}

      {acc.status === 'signed-in' && acc.account && acc.user && (
        <SignedIn
          account={acc.account}
          name={acc.user.name}
          email={acc.user.email}
          balanceText={acc.balanceText ?? '—'}
          error={translateMessage(acc.error)}
          refreshing={acc.refreshing}
          onRefresh={() => void acc.refresh()}
          onLogout={() => {
            void acc.logout()
            onClose()
          }}
        />
      )}

      {acc.status !== 'loading' && (
        <div className="border-t border-line-subtle pt-1">
          <PopoverItem
            icon={<Settings2 size={15} strokeWidth={1.5} className="text-fg-muted" />}
            onClick={() => {
              onClose()
              settings.openSettings('account')
            }}
          >
            {tr('account.AccountMenu.accountSettings')}{' '}
          </PopoverItem>
        </div>
      )}
    </Popover>
  )
}

type Account = NonNullable<ReturnType<typeof useAccount>['account']>

interface SignedInProps {
  account: Account
  name: string
  email: string
  balanceText: string
  error: string | null
  refreshing: boolean
  onRefresh: () => void
  onLogout: () => void
}

function SignedIn({ account, name, email, balanceText, error, refreshing, onRefresh, onLogout }: SignedInProps) {
  useI18n()
  const { plan, rateLimits, currency } = account
  const expires = formatDate(plan?.expiresAt)
  const quotas: Array<[string, Quota | null]> = plan
    ? [
        [tr('account.AccountMenu.today'), plan.daily],
        [tr('account.AccountMenu.thisWeek'), plan.weekly],
        [tr('account.AccountMenu.thisMonth'), plan.monthly],
      ]
    : []
  const shownQuotas = quotas.filter((q): q is [string, Quota] => q[1] !== null)

  // 退出登录要再确认一次；菜单关闭时组件卸载，状态自动复原
  const [confirmingLogout, setConfirmingLogout] = useState(false)

  // 「更新于 …」每 30 秒重新计算一次
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex flex-col">
      <div className="min-w-0 px-3 pt-4 text-center">
        <div className="truncate text-ui font-semibold text-fg">{name}</div>
        <div className="truncate text-meta text-fg-muted">{email}</div>
      </div>

      <div className="px-3 pt-3 pb-4 text-center">
        <div className="text-meta text-fg-muted">{tr('account.AccountMenu.balance')}</div>
        <div className="mt-0.5 text-title leading-none font-semibold text-fg tabular-nums">{balanceText}</div>
        {account.balance === null && (
          <p className="mt-1.5 text-meta text-fg-muted">{tr('account.AccountMenu.balanceIsTemporarilyUnavailable')}</p>
        )}
        <p className="mt-1.5 text-label text-fg-faint" aria-live="polite">
          {refreshing
            ? tr('account.AccountMenu.updating')
            : tr('account.AccountMenu.updated', { p0: formatUpdatedAt(account.updatedAt, now) })}
        </p>
      </div>

      {plan && (
        <div className="flex flex-col gap-2.5 border-t border-line-subtle px-3 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-ui font-medium text-fg">{plan.name}</span>
            {expires && (
              <span className="shrink-0 text-meta text-fg-muted">
                {tr('account.AccountMenu.expires')} {expires}
              </span>
            )}
          </div>
          {shownQuotas.map(([label, q]) => (
            <QuotaBar key={label} label={label} quota={q} currency={currency} />
          ))}
        </div>
      )}

      {rateLimits.length > 0 && (
        <div className="flex flex-col gap-2.5 border-t border-line-subtle px-3 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-ui font-medium text-fg">{tr('account.AccountMenu.limit')}</span>
            <span className="shrink-0 text-meta text-fg-muted">{tr('account.AccountMenu.resetsByTimeWindow')}</span>
          </div>
          {rateLimits.map(r => (
            <QuotaBar
              key={r.window}
              label={tr('account.AccountMenu.every', { p0: formatWindow(r.window) })}
              quota={r}
              currency={currency}
            />
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="border-t border-line-subtle px-3 py-2 text-meta text-danger">
          {translateMessage(error)}
        </p>
      )}

      {confirmingLogout ? (
        <LogoutConfirm
          className="border-t border-line-subtle p-3"
          onCancel={() => setConfirmingLogout(false)}
          onConfirm={onLogout}
        />
      ) : (
        <div className="flex items-stretch gap-1 border-t border-line-subtle p-1">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={tr('account.AccountMenu.refreshCredits')}
            className="press no-drag flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-meta text-fg-secondary hover:bg-hover hover:text-fg disabled:opacity-70"
          >
            <RefreshCw size={14} strokeWidth={1.5} className={cn('shrink-0', refreshing && 'animate-spin')} />
            <span>{tr('account.AccountMenu.refresh')}</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmingLogout(true)}
            className="press no-drag flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-meta text-fg-secondary hover:bg-hover hover:text-danger"
          >
            <LogOut size={14} strokeWidth={1.5} className="shrink-0" />
            <span>{tr('account.AccountMenu.signOut')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
