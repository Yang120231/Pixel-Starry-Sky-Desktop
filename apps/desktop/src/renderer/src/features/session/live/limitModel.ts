// 限流 / 额度用完后到点自动继续（docs/ui/rate-limit-resume.md）：卡片和侧栏用的纯函数。时间一律由调用方传 now。
import type { QueuedMessage } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import { isLimitWait } from '../queueView'

export type LimitPhase = 'waiting' | 'connecting' | 'paused' | 'stopped'

/** 到点后这么久还没开始派发就不再写「正在继续」，回到倒计时的样子 */
const CONNECT_MS = 3000

/** 队列里在等限流恢复的那条（没有为 undefined） */
export const limitItem = (queue: readonly QueuedMessage[] | undefined): QueuedMessage | undefined =>
  queue?.find(isLimitWait)

/** 到点继续后仍被限流的次数 */
export const limitTries = (q: QueuedMessage): number => q.limit?.tries.length ?? 0

/**
 * 卡片处在哪个阶段：stopped 连续失败次数用完（等于 reconnect.max）；paused 队列暂停（取消勾选、或重启后恢复出来的）；
 * connecting 正在发「继续」；其余是倒计时
 */
export function limitPhase(q: QueuedMessage, paused: boolean, now: number): LimitPhase {
  if (limitTries(q) >= (q.reconnect?.max ?? 3)) return 'stopped'
  if (paused) return 'paused'
  if (q.status === 'dispatching') return 'connecting'
  const at = q.reconnect?.at ?? Infinity
  return now >= at && now - at <= CONNECT_MS ? 'connecting' : 'waiting'
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** 卡片上的倒计时：不足 1 小时 12:05，否则 1:23:45；到点后 0:00 */
export function countdownText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

/** 侧栏会话行右边的剩余时间：超过 1 小时写 1:23，不足写「12 分」（向上取整到分钟，至少 1 分） */
export function sidebarRemaining(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000))
  return mins >= 60 ? `${Math.floor(mins / 60)}:${pad(mins % 60)}` : tr('quota.duration.min', { p0: mins })
}

/** 倒计时进度条的比例（0–100）：从开始等到到点 */
export function limitProgress(q: QueuedMessage, now: number): number {
  const r = q.reconnect
  if (!r) return 0
  return Math.min(100, Math.max(0, ((now - r.since) / Math.max(1, r.at - r.since)) * 100))
}
