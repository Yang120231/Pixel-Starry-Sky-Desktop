import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { cn } from '@/ui'
import { formatAmount, isQuotaDanger, quotaPercent } from '@/features/account/format'
import type { Quota } from '../../../../shared/types/account'

/** 一条额度：标签 + 已用 / 上限 + 进度条（超过 90% 用 danger 色）。账号菜单和设置 → 账号共用 */
export function QuotaBar({ label, quota, currency }: { label: string; quota: Quota; currency: string }) {
  useI18n()
  const percent = quotaPercent(quota)
  const danger = isQuotaDanger(quota)
  const unlimited = percent === null
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-meta">
        <span className="text-fg-secondary">{label}</span>
        <span className={cn('tabular-nums', danger ? 'text-danger' : 'text-fg-muted')}>
          {formatAmount(quota.used, currency)} /{' '}
          {unlimited ? tr('account.QuotaBar.message51') : formatAmount(quota.limit, currency)}
        </span>
      </div>
      {!unlimited && (
        <div
          role="progressbar"
          aria-label={tr('account.QuotaBar.message52', { p0: label })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-subtle"
        >
          <div
            className={cn('h-full rounded-full', danger ? 'bg-danger' : 'bg-accent')}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  )
}
