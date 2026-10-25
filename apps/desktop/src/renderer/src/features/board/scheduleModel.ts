// 定时任务的界面数据（docs/ui/board-schedule.md）：默认值、模板、"配置有没有改" 的比较。纯函数，不依赖 window
import type { EngineId } from '@pixelsky/protocol'
import type { TaskSchedule } from '../../../../shared/types/project-tools'

export const defaultSchedule = (engine: EngineId = 'claude'): TaskSchedule => ({
  enabled: true,
  freq: 'daily',
  hour: 9,
  minute: 0,
  weekday: 1,
  engine,
  model: null,
  permission: 'plan',
  session: 'new',
  lastSlot: 0,
  runs: [],
})

/** 空状态里的三个模板：点了打开编辑框并填好（标题、备注走词典 board.schedule.tpl.<id>.*） */
export const SCHEDULE_TEMPLATES = [
  { id: 'deps', freq: 'daily', hour: 9, minute: 0, weekday: 1 },
  { id: 'tests', freq: 'weekdays', hour: 22, minute: 30, weekday: 1 },
  { id: 'git', freq: 'weekly', hour: 10, minute: 0, weekday: 1 },
] as const satisfies ReadonlyArray<Pick<TaskSchedule, 'freq' | 'hour' | 'minute' | 'weekday'> & { id: string }>

/** 只比设置（运行记录、lastSlot 是主进程维护的）：保存时没改设置就不发 */
export function sameSchedule(a: TaskSchedule | null | undefined, b: TaskSchedule | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return (
    a.enabled === b.enabled &&
    a.freq === b.freq &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.weekday === b.weekday &&
    a.engine === b.engine &&
    a.model === b.model &&
    a.permission === b.permission &&
    a.session === b.session
  )
}

const pad = (n: number): string => String(n).padStart(2, '0')
export const timeText = (s: Pick<TaskSchedule, 'hour' | 'minute'>): string => `${pad(s.hour)}:${pad(s.minute)}`

/** "HH:MM" → 时、分；不合法返回 null */
export function parseTime(text: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text)
  if (!m) return null
  const hour = Number(m[1]),
    minute = Number(m[2])
  return hour < 24 && minute < 60 ? { hour, minute } : null
}
