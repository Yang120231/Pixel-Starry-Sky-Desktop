// 定时任务的时间点计算（docs/ui/board-schedule.md §3）：纯函数，主进程到点判断和看板显示「下次」共用。
// 时间按本机本地时区。和频道流程的每天定时（core/channels/flow.ts 的 scheduleDue）不同：那个错过了会补跑，这里不补
import type { TaskSchedule } from './types/project-tools'

type Rule = Pick<TaskSchedule, 'freq' | 'hour' | 'minute' | 'weekday'>

const matchesDay = (s: Rule, day: number): boolean =>
  s.freq === 'weekdays' ? day !== 0 && day !== 6 : s.freq === 'weekly' ? day === s.weekday : true

/** now 或之前最近的一个计划时间点 */
export function latestSlot(s: Rule, now: number): number {
  if (s.freq === 'hourly') {
    const d = new Date(now)
    d.setMinutes(s.minute, 0, 0)
    if (d.getTime() > now) d.setHours(d.getHours() - 1)
    return d.getTime()
  }
  for (let back = 0; back <= 8; back++) {
    const d = new Date(now)
    d.setDate(d.getDate() - back)
    d.setHours(s.hour, s.minute, 0, 0)
    if (d.getTime() <= now && matchesDay(s, d.getDay())) return d.getTime()
  }
  return 0
}

/** now 之后的下一个计划时间点 */
export function nextSlot(s: Rule, now: number): number {
  if (s.freq === 'hourly') {
    const d = new Date(now)
    d.setMinutes(s.minute, 0, 0)
    if (d.getTime() <= now) d.setHours(d.getHours() + 1)
    return d.getTime()
  }
  for (let ahead = 0; ahead <= 8; ahead++) {
    const d = new Date(now)
    d.setDate(d.getDate() + ahead)
    d.setHours(s.hour, s.minute, 0, 0)
    if (d.getTime() > now && matchesDay(s, d.getDay())) return d.getTime()
  }
  return 0
}

/** 错过多久以内还照常运行（机器刚唤醒、定时器晚了几十秒）；超过就记「已错过」 */
export const SCHEDULE_GRACE_MS = 5 * 60_000
