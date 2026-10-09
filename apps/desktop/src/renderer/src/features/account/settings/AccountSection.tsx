import { translateMessage } from '../../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
import { useEffect, useState } from 'react'
import { ExternalLink, LogOut, UserRound } from 'lucide-react'
import { useAccount } from '@/features/account'
import { LogoutConfirm } from '@/features/account/LogoutConfirm'
import { Avatar, Button, Segmented, Spinner, type SegmentedOption } from '@/ui'
import { SectionTitle } from '../../settings/SettingRow'
import { AccountOverview } from './AccountOverview'
import { PlanStore } from './PlanStore'
import { TopUp } from './TopUp'

export type AccountTab = 'overview' | 'plans' | 'topup'

const TABS: Array<SegmentedOption<AccountTab>> = [
  {
    value: 'overview',
    get label() {
      return tr('settings.account.AccountSection.message648')
    },
  },
  {
    value: 'plans',
    get label() {
      return tr('settings.account.AccountSection.message649')
    },
  },
  {
    value: 'topup',
    get label() {
      return tr('settings.account.AccountOverview.message640')
    },
  },
]

/** 设置 → 账号：资料、概览、订阅套餐、充值（docs/ui/settings.md §9） */
export function AccountSection() {
  useI18n()
  const acc = useAccount()
  const [tab, setTab] = useState<AccountTab>('overview')
  const [confirmingLogout, setConfirmingLogout] = useState(false)

  if (acc.status === 'loading') {
    return (
      <section>
        <SectionTitle>{tr('settings.AboutSection.message626')}</SectionTitle>
        <div className="flex items-center gap-2 text-ui text-fg-muted">
          <Spinner />
          {tr('account.AccountMenu.message25')}{' '}
        </div>
      </section>
    )
  }

  if (acc.status !== 'signed-in' || !acc.account || !acc.user) {
    return (
      <section>
        <SectionTitle>{tr('settings.AboutSection.message626')}</SectionTitle>
        <SignedOutCard />
        <AccountService />
      </section>
    )
  }

  return (
    <section>
      <SectionTitle>{tr('settings.AboutSection.message626')}</SectionTitle>

      <div className="rounded-lg border border-line bg-surface">
        <div className="flex items-center gap-3.5 p-4">
          <Avatar name={acc.user.name} size={44} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-section font-semibold text-fg">{acc.user.name}</div>
            <div className="selectable truncate text-meta text-fg-muted">{acc.user.email}</div>
          </div>
          {!confirmingLogout && (
            <Button
              variant="ghost"
              icon={LogOut}
              className="hover:text-danger"
              onClick={() => setConfirmingLogout(true)}
            >
              {tr('account.LogoutConfirm.message50')}{' '}
            </Button>
          )}
        </div>
        {confirmingLogout && (
          <LogoutConfirm
            className="border-t border-line-subtle p-4"
            onCancel={() => setConfirmingLogout(false)}
            onConfirm={() => void acc.logout()}
          />
        )}
      </div>

      <div className="mt-5 mb-4">
        <Segmented
          label={tr('settings.account.AccountSection.message650')}
          options={TABS}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'overview' && (
        <>
          <AccountOverview
            account={acc.account}
            balanceText={acc.balanceText ?? '—'}
            error={translateMessage(acc.error)}
            refreshing={acc.refreshing}
            onRefresh={() => void acc.refresh()}
            onNavigate={setTab}
          />
          <AccountService />
        </>
      )}
      {tab === 'plans' && <PlanStore currentPlan={acc.account.plan?.name ?? null} currency={acc.account.currency} />}
      {tab === 'topup' && <TopUp currency={acc.account.currency} />}
    </section>
  )
}

/** 未登录 / 登录中 */
function SignedOutCard() {
  useI18n()
  const acc = useAccount()
  const signingIn = acc.status === 'signing-in'
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      {acc.error && (
        <p role="alert" className="text-meta text-danger">
          {translateMessage(acc.error)}
        </p>
      )}
      <div className="flex items-center gap-3.5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-subtle text-fg-muted">
          {signingIn ? <Spinner /> : <UserRound size={20} strokeWidth={1.5} />}
        </span>
        <div className="min-w-0">
          <div className="text-section font-semibold text-fg">
            {signingIn ? tr('account.AccountMenu.message29') : tr('sidebar.SidebarFooter.message407')}
          </div>
          <p className="mt-0.5 text-meta text-fg-muted">
            {signingIn ? tr('account.AccountMenu.message30') : tr('settings.account.AccountSection.message651')}
          </p>
        </div>
      </div>
      <div>
        {signingIn ? (
          <Button variant="outline" onClick={() => void acc.cancelLogin()}>
            {tr('account.AccountMenu.message31')}{' '}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void acc.login()}>
            {tr('account.AccountMenu.message28')}{' '}
          </Button>
        )}
      </div>
    </div>
  )
}

/** 认证服务地址 + 在浏览器中管理（复用「关于」页的固定链接 auth） */
function AccountService() {
  useI18n()
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  useEffect(() => {
    window.pixelsky?.app.getInfo().then(
      info => setAuthUrl(info.authUrl),
      () => setAuthUrl(null),
    )
  }, [])
  return (
    <div className="mt-6">
      <h4 className="mb-2 text-meta font-medium text-fg-muted">{tr('settings.account.AccountSection.message652')}</h4>
      <div className="flex min-h-11 items-center gap-4 rounded-lg border border-line px-4 py-1.5">
        <span className="w-20 shrink-0 text-ui text-fg-muted">{tr('settings.AboutSection.message628')}</span>
        <span className="selectable min-w-0 flex-1 truncate font-mono text-meta text-fg">
          {authUrl?.replace(/^https?:\/\//, '') ?? '—'}
        </span>
        <Button
          variant="ghost"
          icon={ExternalLink}
          className="h-7 px-2 text-meta"
          onClick={() => void window.pixelsky?.app.open('auth')}
        >
          {tr('settings.account.AccountSection.message653')}{' '}
        </Button>
      </div>
    </div>
  )
}
