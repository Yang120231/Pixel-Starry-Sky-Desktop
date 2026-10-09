import { tr, getLocale } from '../i18n/core'
// 账号相关的纯格式化函数（余额、更新时间、额度百分比）
import type { Quota } from '../../../preload/account'

const numberFormat = (): Intl.NumberFormat =>
  new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 余额文字：USD 显示 "$12.34"，其他币种显示 "12.34 CNY"；小于 0.01 且大于 0 显示 "<$0.01"；拿不到显示 "—" */
export function formatBalance(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const code = currency.toUpperCase()
  const isUsd = code === 'USD'
  const wrap = (text: string) => (isUsd ? `$${text}` : `${text} ${code}`)
  if (value > 0 && value < 0.01) return isUsd ? '<$0.01' : `<0.01 ${code}`
  const abs = numberFormat().format(Math.abs(value))
  // 四舍五入后为 0 的负数不显示负号
  return value < 0 && abs !== '0.00' ? `-${wrap(abs)}` : wrap(abs)
}

/** 额度里的金额：整数不带小数（"$10"），其他保留 2 位 */
export function formatAmount(value: number, currency = 'USD'): string {
  if (Number.isInteger(value)) {
    const code = currency.toUpperCase()
    const text = value.toLocaleString(getLocale())
    return code === 'USD' ? `$${text}` : `${text} ${code}`
  }
  return formatBalance(value, currency)
}

/** 更新时间：1 分钟内「刚刚」，1 小时内「N 分钟前」，更早显示 HH:mm */
export function formatUpdatedAt(ms: number, now: number = Date.now()): string {
  const diff = now - ms
  if (!Number.isFinite(diff) || diff < 60_000) return tr('account.format.message0')
  if (diff < 3_600_000) return tr('account.format.message1', { p0: Math.floor(diff / 60_000) })
  const d = new Date(ms)
  if (getLocale() === 'en-US')
    return new Intl.DateTimeFormat(getLocale(), { hour: 'numeric', minute: '2-digit' }).format(d)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** ISO 时间 → "yyyy-MM-dd"（本地时区）；解析失败返回 null */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  if (getLocale() === 'en-US')
    return new Intl.DateTimeFormat(getLocale(), { year: 'numeric', month: 'short', day: 'numeric' }).format(d)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 额度已用百分比（0–100）；limit 为 0（不限）或缺省时返回 null */
export function quotaPercent(q: Quota | null | undefined): number | null {
  if (!q || !(q.limit > 0)) return null
  return Math.min(100, Math.max(0, (q.used / q.limit) * 100))
}

/** 用量超过 90% 视为紧张 */
export function isQuotaDanger(q: Quota | null | undefined): boolean {
  const p = quotaPercent(q)
  return p !== null && p > 90
}

/** 限流窗口名：5h → "5 小时"，7d → "7 天"，其他原样显示 */
export function formatWindow(w: string): string {
  const m = /^(\d+)\s*([hd])$/i.exec(w.trim())
  if (!m) return w
  return `${m[1]} ${m[2].toLowerCase() === 'h' ? tr('account.format.message2') : tr('account.format.message3')}`
}

/** 售价：CNY 显示 "¥99" / "¥350.00"（整数不带小数），其他币种显示 "99 USD" */
export function formatPrice(value: number, currency = 'CNY'): string {
  const code = currency.toUpperCase()
  const text = Number.isInteger(value) ? value.toLocaleString(getLocale()) : numberFormat().format(value)
  if (code === 'CNY') return `¥${text}`
  if (code === 'USD') return `$${text}`
  return `${text} ${code}`
}

/** 计费方式：balance_only → 按余额计费，subscription → 订阅计费，其他原样显示 */
export function formatBillingSource(source: string): string {
  if (source === 'balance_only') return tr('account.format.message4')
  if (source === 'subscription') return tr('account.format.message5')
  return source
}
