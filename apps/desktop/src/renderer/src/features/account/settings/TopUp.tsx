import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
import { useState } from 'react'
import { Ticket } from 'lucide-react'
import { formatAmount, formatPrice } from '@/features/account'
import { checkAmount, quoteRecharge } from '../storeLogic'
import { Button, cn } from '@/ui'
import type { StoreCatalog, StoreRecharge } from '../../../../../shared/types/account'
import { OpenPanelButton, type OpenStore } from './StoreParts'

/** 账号 → 充值：金额、赠送规则、到账与应付、支付方式；付款在浏览器里的面板完成（docs/ui/settings.md §9.5） */
export function TopUp({
  catalog,
  currency,
  onOpen,
}: {
  catalog: StoreCatalog
  /** 账号币种：到账额度的单位 */
  currency: string
  onOpen: OpenStore
}) {
  useI18n()
  const { recharge, methods, helpText } = catalog
  const [text, setText] = useState('')

  const redeem = (
    <Button variant="ghost" icon={Ticket} className="h-7 px-2 text-meta" onClick={() => onOpen('redeem')}>
      {tr('settings.account.TopUp.redeemCode')}
    </Button>
  )

  if (!catalog.enabled || !recharge.enabled) {
    return (
      <div>
        <div className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center">
          <div className="text-ui font-medium text-fg">{tr('settings.account.TopUp.rechargeClosed')}</div>
          <p className="mt-1 text-meta text-fg-muted">{tr('settings.account.TopUp.rechargeClosedHint')}</p>
          <OpenPanelButton onOpen={onOpen} />
        </div>
        <div className="mt-3 flex justify-center">{redeem}</div>
      </div>
    )
  }

  const payCurrency = catalog.currency
  const check = checkAmount(text, recharge)
  const quote = check.ok ? quoteRecharge(recharge, check.value) : null
  const error =
    !check.ok && check.reason !== 'empty'
      ? check.reason === 'format'
        ? tr('settings.account.TopUp.enterAmountWithUp')
        : check.reason === 'min'
          ? tr('settings.account.TopUp.minAmount', { p0: formatPrice(recharge.min, payCurrency) })
          : tr('settings.account.TopUp.maxAmount', { p0: formatPrice(recharge.max, payCurrency) })
      : null

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h4 className="mb-2 text-ui font-medium text-fg">{tr('settings.account.TopUp.payAmount')}</h4>
        <div
          className={cn(
            'flex h-9 w-56 items-center gap-1 rounded-md border bg-surface px-3',
            error ? 'border-danger' : 'border-line-strong focus-within:border-accent-line',
          )}
        >
          <span className="text-ui text-fg-muted">{payCurrency.toUpperCase() === 'CNY' ? '¥' : payCurrency}</span>
          <input
            aria-label={tr('settings.account.TopUp.payAmount')}
            inputMode="decimal"
            value={text}
            placeholder={rangeText(recharge, payCurrency)}
            onChange={e => setText(e.target.value.replace(/[^\d.]/g, ''))}
            className="min-w-0 flex-1 bg-transparent text-ui text-fg tabular-nums outline-none placeholder:text-fg-faint"
          />
        </div>
        <p className={cn('mt-1.5 text-meta', error ? 'text-danger' : 'text-fg-faint')}>
          {error ?? rangeLine(recharge, payCurrency)}
        </p>
        {recharge.multiplier !== 1 && (
          <p className="mt-1 text-meta text-fg-faint">
            {tr('settings.account.TopUp.multiplier', {
              p0: formatPrice(1, payCurrency),
              p1: formatAmount(recharge.multiplier, currency),
            })}
          </p>
        )}
      </div>

      {recharge.bonusTiers.length > 0 && (
        <div>
          <h4 className="mb-2 text-ui font-medium text-fg">
            {recharge.bonusMode === 'discount'
              ? tr('settings.account.TopUp.discountRules')
              : tr('settings.account.TopUp.bonusRules')}
          </h4>
          <ul className="flex flex-col gap-1 text-meta text-fg-secondary">
            {recharge.bonusTiers.map(t => (
              <li key={t.minAmount}>
                {tr(
                  recharge.bonusMode === 'discount'
                    ? 'settings.account.TopUp.discountTier'
                    : 'settings.account.TopUp.bonusTier',
                  { p0: formatPrice(t.minAmount, payCurrency), p1: t.bonusPercent },
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-ui font-medium text-fg">{tr('settings.account.TopUp.paymentMethod')}</h4>
        <ul className="flex flex-wrap gap-2" aria-label={tr('settings.account.TopUp.paymentMethod')}>
          {methods.map(m => (
            <li
              key={m.type}
              className="rounded-md border border-line bg-subtle px-2.5 py-1 text-meta text-fg-secondary"
            >
              {m.label}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-meta text-fg-faint">{tr('settings.account.TopUp.chooseInBrowser')}</p>
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <dl className="flex flex-col gap-1.5 text-ui">
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">{tr('settings.account.TopUp.creditsReceived')}</dt>
            <dd className="text-fg tabular-nums">
              {quote ? formatAmount(quote.credited, currency) : '—'}
              {quote && quote.bonus > 0 && (
                <span className="ml-1 text-meta text-accent-fg">
                  {tr('settings.account.TopUp.includingBonus')} {formatAmount(quote.bonus, currency)}）
                </span>
              )}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-fg-muted">{tr('settings.account.TopUp.amountDue')}</dt>
            <dd className="text-section font-semibold text-fg tabular-nums">
              {quote ? formatPrice(quote.pay, payCurrency) : '—'}
              {quote && quote.fee > 0 && (
                <span className="ml-1 text-meta font-normal text-fg-muted">
                  {tr('settings.account.TopUp.includingFee', { p0: formatPrice(quote.fee, payCurrency) })}
                </span>
              )}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex items-center justify-between gap-3">
          {redeem}
          <Button
            variant="primary"
            disabled={!!error}
            className={cn(
              'px-5',
              error && 'cursor-not-allowed bg-disabled! text-disabled-fg! shadow-none! hover:opacity-100',
            )}
            onClick={() => onOpen('purchase')}
          >
            {tr('settings.account.TopUp.pay')}
          </Button>
        </div>
      </div>

      {helpText && <p className="selectable -mt-2 text-meta text-fg-faint">{helpText}</p>}
    </div>
  )
}

function rangeText(r: StoreRecharge, currency: string): string {
  const min = formatPrice(r.min, currency)
  return r.max > 0 ? `${min} – ${formatPrice(r.max, currency)}` : min
}

function rangeLine(r: StoreRecharge, currency: string): string {
  if (r.max > 0)
    return tr('settings.account.TopUp.range', { p0: formatPrice(r.min, currency), p1: formatPrice(r.max, currency) })
  return r.min > 0
    ? tr('settings.account.TopUp.minAmount', { p0: formatPrice(r.min, currency) })
    : tr('settings.account.TopUp.anyAmount')
}
