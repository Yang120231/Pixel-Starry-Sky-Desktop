// 频道时间线的日期 / 时间格式（docs/ui/channels.md §5.1）
import { getLocale, tr } from '../i18n/core'
import { dayStart } from './model'

const WEEKDAYS = '日一二三四五六'

/** 日期分隔：今天 / 昨天 / 10月6日 星期一（英文 Mon, Oct 6）；不是今年时带上年份 */
export function formatDay(at: number, now = Date.now()): string {
  const day = dayStart(at), today = dayStart(now)
  if (day === today) return tr('channels.today')
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (day === yesterday.getTime()) return tr('channels.yesterday')
  const d = new Date(at)
  const otherYear = d.getFullYear() !== new Date(now).getFullYear()
  if (getLocale() === 'en-US') return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(otherYear ? { year: 'numeric' } : {}) }).format(d)
  return `${otherYear ? `${d.getFullYear()}年` : ''}${d.getMonth() + 1}月${d.getDate()}日 星期${WEEKDAYS[d.getDay()]}`
}

/** 消息时间：中文 09:05，英文 9:05 AM */
export function formatClock(at: number): string {
  const d = new Date(at)
  if (getLocale() === 'en-US') return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(d)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
