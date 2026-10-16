// 网页推送（docs/mobile-remote.md §22.2）：比较前后两次会话列表，算出要提醒的；每部手机攒一会儿合成一条，
// 经云端推给不在线或页面在后台的手机。推送内容只有种类和数量，不带任务标题（经过苹果 / 谷歌的推送服务）。
import type { SessionSummary } from '@pixelsky/protocol'

export type PushKind = 'waiting' | 'failed' | 'completed'
export interface PushPayload {
  kind: PushKind
  count: number
}
export type PushCounts = Record<PushKind, number>

/** 每部手机攒这么久合成一条 */
export const PUSH_DELAY = 2000
/** 云端同一部手机两条推送至少隔 5 秒，近了的直接丢掉；这边排到上一条之后 5.5 秒再发 */
export const PUSH_GAP = 5500
/** 几种同时有时取最要紧的 */
const ORDER: PushKind[] = ['waiting', 'failed', 'completed']

const busy = (s: SessionSummary | undefined): boolean => s?.state === 'running' || s?.state === 'starting'

/**
 * 和手机 apps/mobile/src/data/notify.ts 的规则一样，只是「等你处理」要上一份列表里有这个会话：
 * 远程机器连上时它的会话整批出现，已经在等的不算新提醒。prev 为 null（刚启动）时不算，免得把旧状态当成新消息
 */
export function pushChanges(prev: readonly SessionSummary[] | null, next: readonly SessionSummary[]): PushCounts {
  const counts: PushCounts = { waiting: 0, failed: 0, completed: 0 }
  if (!prev) return counts
  const before = new Map(prev.map(s => [s.record.id, s]))
  for (const s of next) {
    if (s.record.archivedAt) continue
    const old = before.get(s.record.id)
    if (s.state === 'waiting' && old && old.state !== 'waiting') counts.waiting++
    else if (busy(old) && s.state === 'idle') {
      if (s.record.lastOutcome === 'failed') counts.failed++
      else if (s.record.lastOutcome === 'completed') counts.completed++
    }
  }
  return counts
}

export function pushPayload(counts: PushCounts): PushPayload | null {
  const kind = ORDER.find(k => counts[k] > 0)
  return kind ? { kind, count: Math.min(99, counts[kind]) } : null
}

/** 每部手机一个攒着的计数，到点发一次；离上一条太近就等到够远再发，期间来的并进去 */
export class PushScheduler {
  private readonly waiting = new Map<string, { counts: PushCounts; timer: ReturnType<typeof setTimeout> }>()
  private readonly sent = new Map<string, number>()

  constructor(
    private readonly send: (phone: string, payload: PushPayload) => Promise<void>,
    private readonly delay = PUSH_DELAY,
    private readonly gap = PUSH_GAP,
    private readonly now: () => number = Date.now,
  ) {}

  add(phone: string, counts: PushCounts): void {
    if (!pushPayload(counts)) return
    const prior = this.waiting.get(phone)
    if (prior) {
      for (const k of ORDER) prior.counts[k] += counts[k]
      return
    }
    const last = this.sent.get(phone)
    const wait = last === undefined ? this.delay : Math.max(this.delay, last + this.gap - this.now())
    const timer = setTimeout(() => {
      const entry = this.waiting.get(phone)
      this.waiting.delete(phone)
      const payload = entry && pushPayload(entry.counts)
      if (!payload) return
      this.sent.set(phone, this.now())
      void this.send(phone, payload).catch(() => {})
    }, wait)
    this.waiting.set(phone, { counts: { ...counts }, timer })
  }

  /** 手机回到前台了：攒着的不用推了 */
  cancel(phone: string): void {
    const entry = this.waiting.get(phone)
    if (entry) clearTimeout(entry.timer)
    this.waiting.delete(phone)
  }

  close(): void {
    for (const phone of [...this.waiting.keys()]) this.cancel(phone)
  }
}
