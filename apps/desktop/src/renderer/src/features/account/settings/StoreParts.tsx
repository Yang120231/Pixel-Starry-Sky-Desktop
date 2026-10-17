import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
import { ExternalLink, TriangleAlert } from 'lucide-react'
import { formatBalance, formatDate } from '@/features/account'
import { Button } from '@/ui'
import type { AccountInfo, StoreLinkKind, StoreLinkParams } from '../../../../../shared/types/account'
import type { AccountChange } from '../storeLogic'

/** 打开面板页：成功后页面上出现「在浏览器里完成付款后回到这里」 */
export type OpenStore = (kind: StoreLinkKind, params?: StoreLinkParams) => void

/** 「打开网页面板」按钮：空状态用 */
export function OpenPanelButton({ onOpen }: { onOpen: OpenStore }) {
  useI18n()
  return (
    <Button variant="outline" icon={ExternalLink} className="mt-4" onClick={() => onOpen('purchase')}>
      {tr('settings.account.Store.openPanel')}
    </Button>
  )
}

/** 商店页顶部：当前余额、套餐和到期时间（用账号里已有的数据，和概览页一致） */
export function StoreHeader({ account }: { account: Pick<AccountInfo, 'balance' | 'currency' | 'plan'> }) {
  useI18n()
  const { plan } = account
  const expires = formatDate(plan?.expiresAt)
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-4 py-2.5 text-ui">
      <span className="text-fg tabular-nums">
        {tr('settings.account.Store.balanceNow', { p0: formatBalance(account.balance, account.currency) })}
      </span>
      <span className="text-fg-secondary">
        {plan ? tr('settings.account.Store.planNow', { p0: plan.name }) : tr('settings.account.Store.planNone')}
        {plan && expires && (
          <span className="ml-1.5 text-meta text-fg-muted">
            {tr('settings.account.Store.planExpires', { p0: expires })}
          </span>
        )}
      </span>
    </div>
  )
}

/** 付款前的账号核对：浏览器里的面板可能登录着别的账号，钱会进到那个号上 */
export function AccountCheckNotice({ email }: { email: string }) {
  useI18n()
  return (
    <div role="note" className="mb-4 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-4 py-2.5">
      <TriangleAlert size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0">
        <div className="selectable text-ui font-medium text-fg">
          {tr('settings.account.Store.accountCheck', { p0: email })}
        </div>
        <p className="mt-0.5 text-meta text-fg-muted">{tr('settings.account.Store.accountCheckHint')}</p>
      </div>
    </div>
  )
}

/** 到账前后的差异：每项一行文字 */
export function changeLines(change: AccountChange, currency: string): string[] {
  const none = tr('settings.account.Store.noValue')
  const lines: string[] = []
  if (change.balance) {
    lines.push(
      tr('settings.account.Store.balanceChange', {
        p0: formatBalance(change.balance.from, currency),
        p1: formatBalance(change.balance.to, currency),
      }),
    )
  }
  if (change.plan) {
    lines.push(tr('settings.account.Store.planChange', { p0: change.plan.from ?? none, p1: change.plan.to ?? none }))
  }
  if (change.expires) {
    lines.push(
      tr('settings.account.Store.expiresChange', {
        p0: formatDate(change.expires.from) ?? none,
        p1: formatDate(change.expires.to) ?? none,
      }),
    )
  }
  return lines
}

/** 刷新结果：到账（前后对比）/ 暂未到账 */
export function PaymentOutcome({
  outcome,
  currency,
}: {
  outcome: { kind: 'arrived'; change: AccountChange } | { kind: 'pending' }
  currency: string
}) {
  useI18n()
  if (outcome.kind === 'pending') {
    return (
      <p role="status" className="text-meta text-fg-secondary">
        {tr('settings.account.Store.notArrived')}
      </p>
    )
  }
  return (
    <div role="status" className="text-meta text-accent-fg">
      <div className="font-medium">{tr('settings.account.Store.arrived')}</div>
      <ul className="mt-0.5 tabular-nums">
        {changeLines(outcome.change, currency).map(line => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}
