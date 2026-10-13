// 订阅套餐与充值的纯计算（docs/ui/settings.md §9.4–9.6）。公式照 Sub2api：
// service/payment_recharge_bonus.go（quoteRechargeBonus）、payment/fee.go（CalculatePayAmountForCurrency）。
import { tr } from '../../i18n/core'
import type { StoreBonusTier, StorePlan, StoreRecharge } from '../../../../shared/types/account'

/** 按十进制四舍五入（半数远离零），避开 1.005 这类浮点误差 */
export function round2(v: number): number {
  const r = Number(`${Math.round(Number(`${Math.abs(v)}e2`))}e-2`)
  return v < 0 ? -r : r
}
function roundUp2(v: number): number {
  return Number(`${Math.ceil(Number(`${v}e2`) - 1e-9)}e-2`)
}

/** 有效期文字：正好 30 / 90 / 365 天显示 月 / 季 / 年，其余按天（「7 天」） */
export function validityLabel(days: number): string {
  if (days === 30) return tr('settings.account.PlanStore.month')
  if (days === 90) return tr('settings.account.PlanStore.quarter')
  if (days === 365) return tr('settings.account.PlanStore.year')
  if (days === 1) return tr('settings.account.PlanStore.oneDay')
  return tr('settings.account.PlanStore.days', { p0: days })
}

/** 账号当前套餐对应的卖品：账号的 plan.name 是订阅分组名（订阅计费时），也兼容与套餐名相同 */
export function isCurrentPlan(plan: Pick<StorePlan, 'name' | 'groupName'>, currentPlan: string | null): boolean {
  if (!currentPlan) return false
  return (!!plan.groupName && plan.groupName === currentPlan) || plan.name === currentPlan
}

/** 命中的赠送 / 折扣档位：不超过支付金额的最大 minAmount */
export function matchTier(tiers: StoreBonusTier[], amount: number): StoreBonusTier | null {
  let hit: StoreBonusTier | null = null
  for (const t of [...tiers].sort((a, b) => a.minAmount - b.minAmount)) {
    if (amount + 1e-9 < t.minAmount) break
    hit = t
  }
  return hit && hit.bonusPercent > 0 ? hit : null
}

export interface RechargeQuote {
  /** 到账总额（美元），含赠送 */
  credited: number
  /** 其中免费的部分 */
  bonus: number
  /** 手续费前的实付基数（折扣模式为折后金额） */
  payBase: number
  fee: number
  /** 应付（支付币种） */
  pay: number
  /** 命中档位的百分比，没命中为 0 */
  percent: number
}

/**
 * 充值报价。amount 是用户输入的支付金额：
 * - 基数 base = round2(amount × multiplier)（美元）
 * - bonus 模式：赠送 = round2(base × 百分比 / 100)，到账 = base + 赠送，实付基数 = amount
 * - discount 模式：实付基数 = round2(amount × (100 − 百分比) / 100)，到账 = base，
 *   免费部分 = base − round2(实付基数 × multiplier)
 * - 手续费 = 向上取整到分(实付基数 × feeRate / 100)，应付 = 实付基数 + 手续费
 */
export function quoteRecharge(r: StoreRecharge, amount: number): RechargeQuote {
  const base = round2(amount * r.multiplier)
  let credited = base
  let bonus = 0
  let payBase = amount
  const tier = matchTier(r.bonusTiers, amount)
  let percent = 0
  if (tier) {
    if (r.bonusMode === 'discount') {
      if (tier.bonusPercent < 100) {
        const discounted = round2((amount * (100 - tier.bonusPercent)) / 100)
        if (discounted > 0 && discounted < amount) {
          payBase = discounted
          bonus = Math.max(0, round2(base - round2(discounted * r.multiplier)))
          percent = tier.bonusPercent
        }
      }
    } else {
      const extra = round2((base * tier.bonusPercent) / 100)
      if (extra > 0) {
        bonus = extra
        credited = round2(base + extra)
        percent = tier.bonusPercent
      }
    }
  }
  const fee = r.feeRate > 0 ? roundUp2((payBase * r.feeRate) / 100) : 0
  return { credited, bonus, payBase, fee, pay: round2(payBase + fee), percent }
}

export type AmountCheck = { ok: true; value: number } | { ok: false; reason: 'empty' | 'format' | 'min' | 'max' }

/** 校验输入的金额：最多两位小数，落在 [min, max]（max 为 0 表示不限） */
export function checkAmount(input: string, r: Pick<StoreRecharge, 'min' | 'max'>): AmountCheck {
  const s = input.trim()
  if (s === '') return { ok: false, reason: 'empty' }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, reason: 'format' }
  const value = Number(s)
  if (!(value > 0)) return { ok: false, reason: 'format' }
  if (value < r.min) return { ok: false, reason: 'min' }
  if (r.max > 0 && value > r.max) return { ok: false, reason: 'max' }
  return { ok: true, value }
}
