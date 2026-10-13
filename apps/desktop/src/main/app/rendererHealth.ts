// 往界面发消息的守卫（docs/ui/renderer-memory.md §3.1.2）：界面崩溃后到新页面报到（app:ready）之前，
// 不再往它发（原来 Render frame was disposed 刷屏）；丢掉的按通道计数，报到时汇总记一条。
import type { WebContents } from 'electron'
import { logger } from '@pixelsky/engine'

const log = logger('app')

/** 重新加载完（did-finish-load）后这么久还没报到，主进程自己结束「恢复中」，免得之后的推送永远被丢 */
export const READY_TIMEOUT_MS = 10_000

interface Health {
  /** 进入恢复中的时刻；null 是没在恢复中 */
  since: number | null
  /** 恢复期间丢掉的消息：通道 → 条数 */
  dropped: Map<string, number>
  /** 一次性操作（托盘命令、点通知）：等页面好了再发，每个通道只留最后一条（连点几次只执行最后一次，不同通道互不顶掉） */
  waiting: Map<string, unknown[]>
  guard: NodeJS.Timeout | null
}

const states = new WeakMap<WebContents, Health>()

function stateOf(wc: WebContents): Health {
  const existing = states.get(wc)
  if (existing) return existing
  const health: Health = { since: null, dropped: new Map(), waiting: new Map(), guard: null }
  states.set(wc, health)
  wc.on('did-finish-load', () => {
    if (health.since !== null) {
      // 重新加载完了还没报到：界面脚本出错或卡住时，10 秒后放弃等待
      if (health.guard) clearTimeout(health.guard)
      health.guard = setTimeout(() => {
        health.guard = null
        if (health.since === null || wc.isDestroyed()) return
        log.warn('界面加载完但没有报到', { ms: Date.now() - health.since })
        markReady(wc)
      }, READY_TIMEOUT_MS)
      health.guard.unref()
    } else flushWaiting(wc, health)
  })
  wc.once('destroyed', () => {
    if (health.guard) clearTimeout(health.guard)
    health.guard = null
    health.waiting.clear()
  })
  return health
}

function flushWaiting(wc: WebContents, health: Health): void {
  if (!health.waiting.size || !canSend(wc)) return
  const waiting = [...health.waiting]
  health.waiting.clear()
  for (const [channel, args] of waiting) wc.send(channel, ...args)
}

/** 能不能往这个 webContents 发：没销毁、没崩溃、不在恢复中 */
export function canSend(wc: WebContents): boolean {
  if (wc.isDestroyed() || wc.isCrashed()) return false
  return (states.get(wc)?.since ?? null) === null
}

/** 走守卫发；发不了时丢掉，恢复中的按通道计数 */
export function sendTo(wc: WebContents, channel: string, ...args: unknown[]): boolean {
  if (canSend(wc)) {
    wc.send(channel, ...args)
    return true
  }
  const health = states.get(wc)
  if (health && health.since !== null) health.dropped.set(channel, (health.dropped.get(channel) ?? 0) + 1)
  return false
}

/** 用户的一次性操作：能发就发；恢复中或页面还在加载时等好了再发，每个通道只留最后一条，窗口关闭时丢掉 */
export function sendWhenReady(wc: WebContents, channel: string, ...args: unknown[]): void {
  if (wc.isDestroyed()) return
  const health = stateOf(wc)
  if (health.since !== null || wc.isCrashed() || wc.isLoading()) {
    health.waiting.set(channel, args)
    return
  }
  wc.send(channel, ...args)
}

/** 崩溃（或恢复中加载失败）时标上「恢复中」；已经在恢复中就保持，计数接着累计 */
export function markRecovering(wc: WebContents): void {
  if (wc.isDestroyed()) return
  const health = stateOf(wc)
  health.since ??= Date.now()
  // 加载中又崩：之前的保险计时作废，等下一次 did-finish-load 重新计
  if (health.guard) clearTimeout(health.guard)
  health.guard = null
}

/** 新页面报到（app:ready）：去掉「恢复中」，记一条汇总，发出等着的一次性操作。不在恢复中时什么都不做 */
export function markReady(wc: WebContents): void {
  const health = states.get(wc)
  if (!health || health.since === null) return
  const ms = Date.now() - health.since
  const channels = Object.fromEntries(health.dropped)
  const total = [...health.dropped.values()].reduce((sum, n) => sum + n, 0)
  health.since = null
  health.dropped.clear()
  if (health.guard) clearTimeout(health.guard)
  health.guard = null
  log.info('恢复期间丢弃的消息', { ms, total, channels })
  flushWaiting(wc, health)
}

/** 现在是不是恢复中（崩溃恢复判断「恢复中加载失败」用） */
export function isRecovering(wc: WebContents): boolean {
  return (states.get(wc)?.since ?? null) !== null
}
