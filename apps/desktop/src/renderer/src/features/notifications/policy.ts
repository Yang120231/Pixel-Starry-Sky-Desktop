// 通知的判断规则（docs/ui/notifications.md §2–§3）。纯函数，不依赖 window，可以直接单测。
import type { HostEvent } from '@pixelsky/protocol'

export type NotificationKind = 'completed' | 'failed' | 'waiting'

export interface NotificationPrefs {
  completed: boolean
  failed: boolean
  waiting: boolean
  /** 只在窗口不在前台时通知 */
  unfocusedOnly: boolean
  /** 使用系统默认提示音 */
  sound: boolean
  /** 手动勿扰到这个时间（毫秒时间戳）；null 表示没有 */
  dndUntil: number | null
  /** 每天定时勿扰，HH:mm；可以跨午夜，起止相同等于关闭 */
  schedule: { enabled: boolean; from: string; to: string }
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  completed: true,
  failed: true,
  waiting: true,
  unfocusedOnly: true,
  sound: true,
  dndUntil: null,
  schedule: { enabled: false, from: '22:00', to: '08:00' },
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/
const minutesOf = (clock: string): number | null => {
  const m = CLOCK.exec(clock)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** 本机保存的偏好可能损坏或来自旧版本：逐项校验，不合法的用默认值 */
export function sanitizeNotificationPrefs(raw: unknown): NotificationPrefs {
  const d = DEFAULT_NOTIFICATION_PREFS
  if (!raw || typeof raw !== 'object') return { ...d, schedule: { ...d.schedule } }
  const v = raw as Record<string, unknown>
  const bool = (key: keyof NotificationPrefs, fallback: boolean) =>
    typeof v[key] === 'boolean' ? (v[key] as boolean) : fallback
  const s = v.schedule && typeof v.schedule === 'object' ? (v.schedule as Record<string, unknown>) : {}
  const clock = (value: unknown, fallback: string) =>
    typeof value === 'string' && CLOCK.test(value) ? value : fallback
  return {
    completed: bool('completed', d.completed),
    failed: bool('failed', d.failed),
    waiting: bool('waiting', d.waiting),
    unfocusedOnly: bool('unfocusedOnly', d.unfocusedOnly),
    sound: bool('sound', d.sound),
    dndUntil: typeof v.dndUntil === 'number' && Number.isFinite(v.dndUntil) ? v.dndUntil : null,
    schedule: {
      enabled: typeof s.enabled === 'boolean' ? s.enabled : d.schedule.enabled,
      from: clock(s.from, d.schedule.from),
      to: clock(s.to, d.schedule.to),
    },
  }
}

/** 定时勿扰是否覆盖 now（按本地时间）；from > to 表示跨午夜 */
export function inSchedule(schedule: NotificationPrefs['schedule'], now: Date): boolean {
  if (!schedule.enabled) return false
  const from = minutesOf(schedule.from),
    to = minutesOf(schedule.to)
  if (from === null || to === null || from === to) return false
  const m = now.getHours() * 60 + now.getMinutes()
  return from < to ? m >= from && m < to : m >= from || m < to
}

/** 现在是否处于勿扰（手动勿扰没到期，或在定时勿扰时段内） */
export function isQuiet(prefs: NotificationPrefs, now: Date): boolean {
  return (prefs.dndUntil !== null && prefs.dndUntil > now.getTime()) || inSchedule(prefs.schedule, now)
}

/** now 之后最近的一个 hour:00（「直到明早 8:00」） */
export function nextMorning(now: Date, hour = 8): number {
  const d = new Date(now)
  d.setHours(hour, 0, 0, 0)
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
  return d.getTime()
}

export interface NotificationIntent {
  kind: NotificationKind
  sessionId: string
  /** 同一个提醒只发一次 */
  dedupeKey: string
  /** 等你处理：审批标题 / 命令；出错：错误原文 */
  detail: string | null
}

/** 引擎事件 → 要不要考虑提醒；用户主动打断的回合不提醒 */
export function notificationFor(event: HostEvent): NotificationIntent | null {
  if (event.kind !== 'session') return null
  const e = event.event
  if (e.type === 'turn_completed') {
    if (e.outcome === 'completed')
      return {
        kind: 'completed',
        sessionId: event.sessionId,
        dedupeKey: `c:${event.sessionId}:${e.turnId}`,
        detail: null,
      }
    if (e.outcome === 'failed')
      return {
        kind: 'failed',
        sessionId: event.sessionId,
        dedupeKey: `f:${event.sessionId}:${e.turnId}`,
        detail: e.error,
      }
    return null
  }
  if (e.type === 'approval_request') {
    const r = e.request
    const detail = r.command?.trim() || r.questions?.[0]?.question?.trim() || r.title
    return {
      kind: 'waiting',
      sessionId: event.sessionId,
      dedupeKey: `w:${event.sessionId}:${r.requestId}`,
      detail: detail || null,
    }
  }
  return null
}

export interface DeliveryState {
  /** 已经提醒过的 dedupeKey */
  seen: Set<string>
  /** 最近一次提醒的时间：会话 id → 毫秒 */
  lastBySession: Map<string, number>
  /** 最近 10 秒内的提醒时间 */
  recent: number[]
}

export const createDeliveryState = (): DeliveryState => ({ seen: new Set(), lastBySession: new Map(), recent: [] })

export const SESSION_GAP_MS = 3000
export const BURST_WINDOW_MS = 10_000
export const BURST_LIMIT = 4

export type Decision =
  | { show: false; reason: 'disabled' | 'quiet' | 'focused' | 'viewing' | 'duplicate' | 'throttled' }
  | { show: true; summary: boolean }

/**
 * 决定是否弹出。依次检查：开关 → 去重 → 勿扰 → 前台规则 → 同会话 3 秒限流 → 10 秒内超过 4 条合并成一条摘要。
 * 会修改 state（记录已提醒），调用方只在 show 时真正弹出。
 */
export function decide(
  intent: NotificationIntent,
  ctx: { prefs: NotificationPrefs; focused: boolean; viewing: boolean; now: number },
  state: DeliveryState,
): Decision {
  if (!ctx.prefs[intent.kind]) return { show: false, reason: 'disabled' }
  if (state.seen.has(intent.dedupeKey)) return { show: false, reason: 'duplicate' }
  state.seen.add(intent.dedupeKey)
  if (state.seen.size > 500) state.seen.delete(state.seen.values().next().value as string)
  if (isQuiet(ctx.prefs, new Date(ctx.now))) return { show: false, reason: 'quiet' }
  if (ctx.focused && (ctx.prefs.unfocusedOnly || ctx.viewing))
    return { show: false, reason: ctx.prefs.unfocusedOnly ? 'focused' : 'viewing' }
  const last = state.lastBySession.get(intent.sessionId)
  if (last !== undefined && ctx.now - last < SESSION_GAP_MS) return { show: false, reason: 'throttled' }
  state.lastBySession.set(intent.sessionId, ctx.now)
  state.recent = state.recent.filter(t => ctx.now - t < BURST_WINDOW_MS)
  state.recent.push(ctx.now)
  if (state.recent.length > BURST_LIMIT + 1) return { show: false, reason: 'throttled' }
  return { show: true, summary: state.recent.length === BURST_LIMIT + 1 }
}
