import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { Check } from 'lucide-react'
import { formatAmount, formatPrice } from '@/account'
import { Button, cn, useComingSoon } from '@/components/ui'
import { billing, type PlanOffer } from '@/mock/data'

const PERIOD_LABELS: Record<PlanOffer['period'], string> = { get month() { return tr("settings.account.PlanStore.message654") }, get quarter() { return tr("settings.account.PlanStore.message655") }, get year() { return tr("settings.account.PlanStore.message656") } }

const quotaLabels = (): Array<[keyof PlanOffer['quotas'], string]> => [
  ['daily', tr("settings.account.PlanStore.message657")],
  ['weekly', tr("settings.account.PlanStore.message658")],
  ['monthly', tr("settings.account.PlanStore.message659")],
]

/** 账号 → 订阅套餐：套餐卡片。购买暂未接入，按钮只弹「即将推出」（docs/ui/settings.md §9.4） */
export function PlanStore({ currentPlan, currency }: { currentPlan: string | null; currency: string }) {
  useI18n()
  const comingSoon = useComingSoon()
  const { plans, planNote, priceCurrency } = billing

  if (plans.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center">
        <div className="text-ui font-medium text-fg">{tr("settings.account.PlanStore.message660")}</div>
        <p className="mt-1 text-meta text-fg-muted">{tr("settings.account.PlanStore.message661")}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2.5">
        {plans.map((plan) => {
          const current = plan.name === currentPlan
          const action = current ? tr("settings.account.PlanStore.message662") : currentPlan ? tr("settings.account.PlanStore.message663") : tr("settings.account.PlanStore.message664")
          return (
            <div
              key={plan.id}
              className={cn(
                'flex min-w-0 flex-col rounded-lg border bg-surface p-3.5',
                plan.recommended ? 'border-accent-line' : 'border-line',
              )}
            >
              <div className="flex min-h-5 items-center gap-1.5">
                <span className="min-w-0 truncate text-ui font-medium text-fg">{plan.name}</span>
                {current ? (
                  <Tag>{tr("settings.account.PlanStore.message665")}</Tag>
                ) : (
                  plan.recommended && <Tag>{tr("settings.account.PlanStore.message666")}</Tag>
                )}
              </div>

              <div className="mt-2 flex items-baseline gap-0.5">
                <span className="text-title leading-none font-semibold text-fg tabular-nums">
                  {formatPrice(plan.price, priceCurrency)}
                </span>
                <span className="text-meta text-fg-muted">/{PERIOD_LABELS[plan.period]}</span>
              </div>

              <dl className="mt-3 flex flex-col gap-1 border-t border-line-subtle pt-3 text-meta">
                {quotaLabels().map(([key, label]) => {
                  const value = plan.quotas[key]
                  if (value === undefined) return null
                  return (
                    <div key={key} className="flex justify-between gap-2">
                      <dt className="text-fg-muted">{label}{tr("settings.account.PlanStore.message667")}</dt>
                      <dd className="text-fg tabular-nums">{formatAmount(value, currency)}</dd>
                    </div>
                  )
                })}
              </dl>

              <ul className="mt-3 flex flex-col gap-1 text-meta text-fg-secondary">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <Check size={13} strokeWidth={2} className="mt-0.5 shrink-0 text-accent-fg" />
                    <span className="min-w-0">{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto pt-4">
                <Button
                  variant={plan.recommended || current ? 'primary' : 'outline'}
                  className="w-full justify-center"
                  onClick={() => comingSoon(tr("settings.account.PlanStore.message668"))}
                >
                  {action}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
      {planNote && <p className="mt-3 text-meta text-fg-faint">{planNote}</p>}
    </div>
  )
}

function Tag({ children }: { children: string }) {
  useI18n()
  return (
    <span className="shrink-0 rounded-sm bg-accent-soft px-1.5 py-px text-label font-medium text-accent-fg">{children}</span>
  )
}
