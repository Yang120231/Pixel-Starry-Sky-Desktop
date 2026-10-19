// 像素星空平台账号的额度（docs/ui/account-quota.md §6.9）：把账号模块现成的 AccountInfo 换算成 AccountQuota，
// 界面和 Claude / ChatGPT 的额度走同一套卡片。云端只给 5h / 1d / 7d 窗口的已用金额和上限，没有恢复时间。
import { quotaWindowId, type AccountQuota, type QuotaWindow } from '@pixelsky/protocol'
import type { AccountInfo } from '../../../../../shared/types/account'
import type { PlanLimit } from './quotaModel'

/** 「5h」「1d」「7d」换成分钟；认不出来为 null */
export function windowMinutes(window: string): number | null {
  const m = /^(\d+)\s*([hd])$/i.exec(window.trim())
  if (!m) return null
  const n = Number(m[1])
  if (!(n > 0)) return null
  return m[2].toLowerCase() === 'h' ? n * 60 : n * 1_440
}

const percentOf = (used: number, limit: number): number => Math.min(100, Math.max(0, (used / limit) * 100))

/** 账号 → 额度快照；没登录为 null。limit 为 0（不限）的窗口跳过 */
export function platformQuota(account: AccountInfo | null): AccountQuota | null {
  if (!account) return null
  const windows: QuotaWindow[] = []
  account.rateLimits.forEach((r, i) => {
    if (!(r.limit > 0) || !Number.isFinite(r.used)) return
    const durationMins = windowMinutes(r.window)
    windows.push({
      id: quotaWindowId(durationMins, i),
      durationMins,
      usedPercent: percentOf(r.used, r.limit),
      resetsAt: null,
      money: { used: r.used, limit: r.limit, currency: account.currency },
    })
  })
  const balance = account.balance === null ? null : { amount: account.balance, currency: account.currency }
  return {
    provider: 'platform',
    status: windows.length || balance ? 'ok' : 'empty',
    plan: account.plan?.name ?? null,
    account: account.name || null,
    windows,
    extras: { balance },
    blocked: null,
    observedAt: account.updatedAt,
    fetchedAt: account.updatedAt,
    source: 'usage',
    refreshable: true,
    error: null,
  }
}

/** 套餐的每天 / 每周 / 每月额度（limit 大于 0 的），进弹窗的「其它」小列表 */
export function platformPlanLimits(account: AccountInfo | null): PlanLimit[] {
  const plan = account?.plan
  if (!account || !plan) return []
  const out: PlanLimit[] = []
  for (const id of ['daily', 'weekly', 'monthly'] as const) {
    const q = plan[id]
    if (q && q.limit > 0) out.push({ id, used: q.used, limit: q.limit, currency: account.currency })
  }
  return out
}
