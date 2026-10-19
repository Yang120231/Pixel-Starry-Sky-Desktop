// Claude Code 的账号额度（docs/ui/account-quota.md §3.2）：get_usage 控制请求的回包和每次请求后的 rate_limit_event。
// 两个都是实验性 / 内部字段，形状随时会变：只认实测过的字段，缺什么就不出那一项，不认识的一律忽略，绝不因为形状变了抛错。
import type { QuotaExtraUsage, QuotaModelLimit, QuotaWindow } from '@pixelsky/protocol'
import { quotaWindowId } from '@pixelsky/protocol'
import { quotaNoDataError, clampPercent, epochMs, type AccountQuotaPatch, type QuotaReading } from '../quota'
import { obj, str, type Shape } from './shape'

const FIVE_HOUR = 300
const WEEK = 10_080

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function quotaWindow(
  durationMins: number,
  percent: number | null,
  resetsAt: unknown,
  locked = false,
): QuotaWindow | null {
  if (percent === null) return null
  return {
    id: quotaWindowId(durationMins),
    durationMins,
    usedPercent: percent,
    resetsAt: epochMs(resetsAt),
    ...(locked ? { rejected: true } : {}),
  }
}

function model(name: string, percent: number | null, resetsAt: unknown, locked = false): QuotaModelLimit | null {
  if (percent === null || !name) return null
  return {
    name,
    durationMins: WEEK,
    usedPercent: percent,
    resetsAt: epochMs(resetsAt),
    ...(locked ? { rejected: true } : {}),
  }
}

const lockedReason = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0

/** 最小单位金额 → 主单位 */
function minor(amount: unknown, exponent: unknown): number | null {
  const n = finite(amount)
  if (n === null) return null
  const e = finite(exponent)
  return n / 10 ** (e !== null && e >= 0 && e <= 6 ? e : 2)
}

function extraUsage(rl: Shape): QuotaExtraUsage | null {
  const spend = obj(rl.spend)
  const extra = obj(rl.extra_usage)
  const reached = extra.spend_limit_reached === true
  if (spend.enabled === true) {
    const used = obj(spend.used)
    const limit = obj(spend.limit)
    const usedAmount = minor(used.amount_minor, used.exponent)
    const limitAmount = minor(limit.amount_minor, limit.exponent)
    return {
      enabled: true,
      used: usedAmount,
      limit: limitAmount,
      currency: str(used.currency) || str(limit.currency) || null,
      usedPercent: clampPercent(spend.percent) ?? ratio(usedAmount, limitAmount),
      ...(reached ? { reached } : {}),
    }
  }
  if (extra.is_enabled !== true) return null
  // 真实的「开了额外用量」形状没实测过：金额按最小单位换算，再用 utilization 交叉校验，对不上就只留百分比
  const dp = finite(extra.decimal_places)
  const scale = 10 ** (dp !== null && dp >= 0 && dp <= 6 ? dp : 2)
  let used = finite(extra.used_credits) === null ? null : finite(extra.used_credits)! / scale
  let limit = finite(extra.monthly_limit) === null ? null : finite(extra.monthly_limit)! / scale
  const utilization = clampPercent(extra.utilization)
  const byAmount = ratio(used, limit)
  if (utilization === null || byAmount === null || Math.abs(byAmount - utilization) > 2) {
    used = null
    limit = null
  }
  return {
    enabled: true,
    used,
    limit,
    currency: str(extra.currency) || null,
    usedPercent: utilization ?? byAmount,
    ...(reached ? { reached } : {}),
  }
}

/** 已用 / 上限 → 百分比；上限不是正数为 null */
function ratio(used: number | null, limit: number | null): number | null {
  if (used === null || limit === null || limit <= 0) return null
  return clampPercent((used / limit) * 100)
}

/**
 * get_usage 的回包 → 统一的读取结果。
 * - 空对象、或既没有 rate_limits_available 也没有 rate_limits / subscription_type → no-request（假引擎和旧版对不认识的控制请求可能回 {}）
 * - rate_limits_available 为 false，或 subscription_type 和 rate_limits 都是 null → unsupported（API Key、Bedrock / Vertex）
 * - rate_limits_available 为真但 rate_limits 不是对象 → 抛「没有拿到额度数据」
 */
export function parseClaudeUsage(raw: unknown, observedAt: number): QuotaReading {
  const r = obj(raw)
  if (r.rate_limits_available === undefined && r.rate_limits === undefined && r.subscription_type === undefined)
    return { kind: 'no-request' }
  if (r.rate_limits_available === false) return { kind: 'unsupported' }
  if (r.subscription_type === null && r.rate_limits === null) return { kind: 'unsupported' }
  const rl = obj(r.rate_limits)
  if (!r.rate_limits || typeof r.rate_limits !== 'object' || Array.isArray(r.rate_limits)) throw quotaNoDataError()

  const limits = (Array.isArray(rl.limits) ? rl.limits : []).map(obj)
  const windows: QuotaWindow[] = []
  const addWindow = (durationMins: number, topKey: string, limitKind: string): void => {
    const top = obj(rl[topKey])
    const fromTop = quotaWindow(
      durationMins,
      clampPercent(top.utilization),
      top.resets_at,
      lockedReason(top.locked_reason),
    )
    if (fromTop) return void windows.push(fromTop)
    // 顶层没有这个窗口：用 limits[] 补
    const item = limits.find(l => l.kind === limitKind)
    if (!item) return
    const fromLimits = quotaWindow(
      durationMins,
      clampPercent(item.percent),
      item.resets_at,
      lockedReason(item.locked_reason),
    )
    if (fromLimits) windows.push(fromLimits)
  }
  addWindow(FIVE_HOUR, 'five_hour', 'session')
  addWindow(WEEK, 'seven_day', 'weekly_all')

  // 分模型的周额度：model_scoped[] → limits[] 里的 weekly_scoped → seven_day_opus / seven_day_sonnet，哪一层有就用哪一层，按名字去重
  const models: QuotaModelLimit[] = []
  const addModel = (m: QuotaModelLimit | null): void => {
    if (m && !models.some(x => x.name === m.name)) models.push(m)
  }
  for (const item of Array.isArray(rl.model_scoped) ? rl.model_scoped.map(obj) : [])
    addModel(model(str(item.display_name), clampPercent(item.utilization), item.resets_at))
  if (!models.length)
    for (const item of limits.filter(l => l.kind === 'weekly_scoped'))
      addModel(
        model(
          str(obj(obj(item.scope).model).display_name),
          clampPercent(item.percent),
          item.resets_at,
          lockedReason(item.locked_reason),
        ),
      )
  if (!models.length) {
    for (const [key, name] of [
      ['seven_day_opus', 'Opus'],
      ['seven_day_sonnet', 'Sonnet'],
    ] as const) {
      const item = obj(rl[key])
      addModel(model(name, clampPercent(item.utilization), item.resets_at, lockedReason(item.locked_reason)))
    }
  }

  const extras: Extract<QuotaReading, { kind: 'ok' }>['extras'] = {}
  if (models.length) extras.models = models
  const extra = extraUsage(rl)
  if (extra) extras.extraUsage = extra
  return {
    kind: 'ok',
    plan: str(r.subscription_type) || null,
    account: null,
    windows,
    extras,
    blocked: null,
    observedAt,
  }
}

/** unifiedWindows 的键 → 窗口时长 / 分模型名 */
const EVENT_WINDOWS: Record<string, { mins: number } | { model: string }> = {
  five_hour: { mins: FIVE_HOUR },
  seven_day: { mins: WEEK },
  seven_day_opus: { model: 'Opus' },
  seven_day_sonnet: { model: 'Sonnet' },
}

/**
 * rate_limit_event 里的 rate_limit_info → 对快照的部分更新。utilization 是 0–1（@internal），resetsAt 是秒。
 * 不是对象、或什么有用的都没带返回 null
 */
export function parseClaudeRateLimitEvent(info: unknown, observedAt: number): AccountQuotaPatch | null {
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null
  const o = obj(info)
  const windows: QuotaWindow[] = []
  const models: QuotaModelLimit[] = []
  const put = (key: string, utilization: unknown, resetsAt: unknown, scale: 1 | 100): void => {
    const target = Object.hasOwn(EVENT_WINDOWS, key) ? EVENT_WINDOWS[key] : undefined
    if (!target) return
    const percent = clampPercent(utilization, scale)
    if ('mins' in target) {
      const w = quotaWindow(target.mins, percent, resetsAt)
      if (w) windows.push(w)
    } else {
      const m = model(target.model, percent, resetsAt)
      if (m) models.push(m)
    }
  }
  const unified = obj(o.unifiedWindows)
  const entries = Object.entries(unified)
  if (entries.length) for (const [key, v] of entries) put(key, obj(v).utilization, obj(v).resetsAt, 1)
  else put(str(o.rateLimitType), o.utilization, o.resetsAt, 1)

  const patch: AccountQuotaPatch = { observedAt }
  const status = str(o.status)
  const type = str(o.rateLimitType)
  if (status === 'rejected') {
    const target = Object.hasOwn(EVENT_WINDOWS, type) ? EVENT_WINDOWS[type] : undefined
    if (target) {
      // 对得上窗口 / 模型：标那一项用完（事件没带这一项时按 100% 补一项）
      if ('mins' in target) {
        const id = quotaWindowId(target.mins)
        const i = windows.findIndex(w => w.id === id)
        const base = i >= 0 ? windows[i] : quotaWindow(target.mins, 100, o.resetsAt)!
        const next = { ...base, usedPercent: 100, rejected: true }
        if (i >= 0) windows[i] = next
        else windows.push(next)
      } else {
        const i = models.findIndex(m => m.name === target.model)
        const base = i >= 0 ? models[i] : model(target.model, 100, o.resetsAt)!
        const next = { ...base, usedPercent: 100, rejected: true }
        if (i >= 0) models[i] = next
        else models.push(next)
      }
    } else patch.blocked = { kind: type || 'rejected', resetsAt: epochMs(o.resetsAt) }
  } else if (status === 'allowed' || status === 'allowed_warning') {
    patch.allowed = true
    patch.blocked = null
  }
  if (windows.length) patch.windows = windows
  if (models.length) patch.models = models
  if (typeof o.isUsingOverage === 'boolean') patch.overage = o.isUsingOverage
  return Object.keys(patch).length > 1 ? patch : null
}

/** get_usage 控制请求报「不认识」（旧版 Claude Code）；超时、进程退出不算 */
export function unknownControl(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  if (/没有回应|进程已退出/.test(message)) return false
  return /unknown|unsupported|not supported|unrecognized|invalid.*subtype/i.test(message)
}
