import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useState, type ReactNode } from 'react'
import { formatAmount, formatPrice } from '@/account'
import { Button, Segmented, cn, useComingSoon } from '@/components/ui'
import { billing } from '@/mock/data'

/** 选中的金额：预设选项的下标，或自定义 */
type Choice = number | 'custom'

/** 账号 → 充值：金额、支付方式、应付金额。支付暂未接入，按钮只弹「即将推出」（docs/ui/settings.md §9.5） */
export function TopUp({ currency }: { currency: string }) {
  useI18n()
  const comingSoon = useComingSoon()
  const { topUpOptions, customTopUp, paymentMethods, priceCurrency, rate, topUpNote } = billing

  const [choice, setChoice] = useState<Choice>(topUpOptions.length > 0 ? 0 : 'custom')
  const [customText, setCustomText] = useState('')
  const [method, setMethod] = useState(paymentMethods[0]?.id ?? '')

  // 当前选择对应的到账额度、赠送额度；自定义金额不合法时 credit 为 null
  let credit: number | null = null
  let bonus = 0
  let customError: string | null = null
  if (choice === 'custom') {
    const value = Number(customText)
    if (customText.trim() === '') {
      credit = null
    } else if (!Number.isFinite(value) || !/^\d+(\.\d{1,2})?$/.test(customText.trim())) {
      customError = tr('settings.account.TopUp.message669')
    } else if (customTopUp && (value < customTopUp.min || value > customTopUp.max)) {
      customError = tr('settings.account.TopUp.message670', {
        p0: formatAmount(customTopUp.min, currency),
        p1: formatAmount(customTopUp.max, currency),
      })
    } else {
      credit = value
    }
  } else {
    const option = topUpOptions[choice]
    credit = option?.credit ?? null
    bonus = option?.bonus ?? 0
  }

  const canPay = credit !== null && paymentMethods.length > 0

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h4 className="mb-2 text-ui font-medium text-fg">{tr('settings.account.TopUp.message671')}</h4>
        <div role="radiogroup" aria-label={tr('settings.account.TopUp.message671')} className="grid grid-cols-5 gap-2">
          {topUpOptions.map((o, i) => (
            <AmountButton key={o.credit} selected={choice === i} onClick={() => setChoice(i)}>
              <span className="text-ui font-semibold text-fg tabular-nums">{formatAmount(o.credit, currency)}</span>
              {o.bonus ? (
                <span className="text-label text-accent-fg">
                  {tr('settings.account.TopUp.message672')} {formatAmount(o.bonus, currency)}
                </span>
              ) : (
                <span className="text-label text-fg-faint">{formatPrice(o.credit * rate, priceCurrency)}</span>
              )}
            </AmountButton>
          ))}
          {customTopUp && (
            <AmountButton selected={choice === 'custom'} onClick={() => setChoice('custom')}>
              <span className="text-ui font-semibold text-fg">{tr('settings.account.TopUp.message673')}</span>
              <span className="text-label text-fg-faint">{tr('settings.account.TopUp.message674')}</span>
            </AmountButton>
          )}
        </div>

        {choice === 'custom' && customTopUp && (
          <div className="mt-3">
            <div
              className={cn(
                'flex h-9 w-56 items-center gap-1 rounded-md border bg-surface px-3',
                customError ? 'border-danger' : 'border-line-strong focus-within:border-accent-line',
              )}
            >
              <span className="text-ui text-fg-muted">{currency.toUpperCase() === 'USD' ? '$' : currency}</span>
              <input
                aria-label={tr('settings.account.TopUp.message675')}
                inputMode="decimal"
                autoFocus
                value={customText}
                placeholder={`${customTopUp.min} – ${customTopUp.max}`}
                onChange={e => setCustomText(e.target.value.replace(/[^\d.]/g, ''))}
                className="min-w-0 flex-1 bg-transparent text-ui text-fg tabular-nums outline-none placeholder:text-fg-faint"
              />
            </div>
            <p className={cn('mt-1.5 text-meta', customError ? 'text-danger' : 'text-fg-faint')}>
              {customError ??
                tr('settings.account.TopUp.message676', {
                  p0: formatAmount(customTopUp.min, currency),
                  p1: formatAmount(customTopUp.max, currency),
                })}
            </p>
          </div>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-ui font-medium text-fg">{tr('settings.account.TopUp.message677')}</h4>
        {paymentMethods.length > 0 ? (
          <Segmented
            label={tr('settings.account.TopUp.message677')}
            options={paymentMethods.map(m => ({ value: m.id, label: m.label }))}
            value={method}
            onChange={setMethod}
          />
        ) : (
          <p className="text-meta text-fg-muted">{tr('settings.account.TopUp.message678')}</p>
        )}
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <dl className="flex flex-col gap-1.5 text-ui">
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">{tr('settings.account.TopUp.message679')}</dt>
            <dd className="text-fg tabular-nums">
              {credit === null ? '—' : formatAmount(credit + bonus, currency)}
              {credit !== null && bonus > 0 && (
                <span className="ml-1 text-meta text-accent-fg">
                  {tr('settings.account.TopUp.message680')} {formatAmount(bonus, currency)}）
                </span>
              )}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-fg-muted">{tr('settings.account.TopUp.message681')}</dt>
            <dd className="text-section font-semibold text-fg tabular-nums">
              {credit === null ? '—' : formatPrice(Math.round(credit * rate * 100) / 100, priceCurrency)}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            disabled={!canPay}
            className={cn(
              'px-5',
              !canPay && 'cursor-not-allowed bg-disabled! text-disabled-fg! shadow-none! hover:opacity-100',
            )}
            onClick={() => comingSoon(tr('settings.account.TopUp.message682'))}
          >
            {tr('settings.account.TopUp.message683')}{' '}
          </Button>
        </div>
      </div>

      {topUpNote && <p className="-mt-2 text-meta text-fg-faint">{topUpNote}</p>}
    </div>
  )
}

function AmountButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  useI18n()
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'press flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border',
        selected ? 'border-accent-line bg-accent-soft' : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      {children}
    </button>
  )
}
