// 反馈状态缓存、轮询结果处理和通知去重（docs/ui/feedback.md §2.6）。不依赖 Electron：定时、窗口焦点由 feedback.ts 接。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { FeedbackChange, FeedbackList, FeedbackState, FeedbackSummary } from '../../shared/types/feedback'

/** 每个账号记下「已经提醒过的回复」：threadId → 提醒时那条的更新时间 */
export interface NotifiedStore {
  get(email: string): Record<string, number>
  record(email: string, entries: Record<string, number>): void
}

const STORE_VERSION = 1
/** 每个账号最多留这么多条记录，超过丢最旧的 */
const MAX_NOTIFIED = 500

/** userData/feedback.json：{version:1, accounts:{[email]:{notified:{[threadId]: 时间}}}}；先写临时文件再改名 */
export class FileNotifiedStore implements NotifiedStore {
  private accounts: Record<string, { notified: Record<string, number> }> = {}

  constructor(private readonly file: string) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; accounts?: unknown }
      if (raw.version === STORE_VERSION && raw.accounts && typeof raw.accounts === 'object') {
        for (const [email, value] of Object.entries(raw.accounts as Record<string, unknown>)) {
          const notified = (value as { notified?: unknown } | null)?.notified
          if (!notified || typeof notified !== 'object') continue
          const clean: Record<string, number> = {}
          for (const [id, at] of Object.entries(notified as Record<string, unknown>))
            if (typeof at === 'number' && Number.isFinite(at)) clean[id] = at
          this.accounts[email] = { notified: clean }
        }
      }
    } catch {
      // 没有文件或损坏：当作还没提醒过
    }
  }

  get(email: string): Record<string, number> {
    return { ...(this.accounts[email]?.notified ?? {}) }
  }

  record(email: string, entries: Record<string, number>): void {
    const merged = { ...(this.accounts[email]?.notified ?? {}), ...entries }
    const keys = Object.keys(merged)
    if (keys.length > MAX_NOTIFIED) {
      for (const key of keys.sort((a, b) => merged[a] - merged[b]).slice(0, keys.length - MAX_NOTIFIED))
        delete merged[key]
    }
    this.accounts[email] = { notified: merged }
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify({ version: STORE_VERSION, accounts: this.accounts }), { mode: 0o600 })
      renameSync(tmp, this.file)
    } catch {
      // 写不下来只会让下次启动多提醒一次
    }
  }
}

export interface TrackerDeps {
  /** 拉第一页 */
  list(): Promise<FeedbackList>
  store: NotifiedStore
  emit(change: FeedbackChange): void
  /** 检查失败（登录过期除外）：同一个原因连续失败只报一次 */
  onError?(error: { code: string | null; message: string }): void
  now?: () => number
}

/** 平时每 10 分钟检查一次；提交 / 补充之后的 30 分钟里每 2 分钟一次（团队多半这时候回复） */
export const POLL_INTERVAL_MS = 10 * 60_000
export const ACTIVE_POLL_INTERVAL_MS = 2 * 60_000
export const ACTIVE_WINDOW_MS = 30 * 60_000

type Failure = { code?: string; message?: string }

export const SIGNED_OUT: FeedbackState = {
  status: 'signed-out',
  email: null,
  unreadCount: 0,
  threads: [],
  nextBefore: null,
  error: null,
  checkedAt: null,
}

export class FeedbackTracker {
  private current: FeedbackState = SIGNED_OUT
  private inflight: Promise<FeedbackState> | null = null
  private again = false
  /** 登录状态变化就加一，作废还在途中的检查 */
  private epoch = 0
  private lastPollAt = 0
  /** 上次提交 / 补充反馈的时间 */
  private activeAt = 0
  /** 上次报过的失败原因；检查成功后清掉 */
  private lastError: string | null = null
  private readonly now: () => number

  constructor(private readonly deps: TrackerDeps) {
    this.now = deps.now ?? Date.now
  }

  state(): FeedbackState {
    return this.current
  }

  /** 距上次检查多久（毫秒）；从没检查过、或者系统时间往回调过，是 Infinity（马上可以再查） */
  sinceLastPoll(): number {
    const elapsed = this.now() - this.lastPollAt
    return this.lastPollAt && elapsed >= 0 ? elapsed : Infinity
  }

  /** 提交或补充了反馈：接下来一段时间检查得勤一些 */
  markActive(): void {
    this.activeAt = this.now()
  }

  /** 现在该隔多久检查一次 */
  pollInterval(): number {
    const elapsed = this.now() - this.activeAt
    // 系统时间往回调过（elapsed < 0）当作已经过了这段时间
    return this.activeAt && elapsed >= 0 && elapsed < ACTIVE_WINDOW_MS ? ACTIVE_POLL_INTERVAL_MS : POLL_INTERVAL_MS
  }

  /** 定时器每次醒来问一下：到时间了就检查 */
  due(): boolean {
    return this.sinceLastPoll() >= this.pollInterval()
  }

  /** 登录账号变化（null 表示没登录）。换账号 / 退出登录先清空，登录后马上检查一次 */
  setAccount(email: string | null): Promise<FeedbackState> {
    if (email === this.current.email) return this.inflight ?? Promise.resolve(this.current)
    this.epoch++
    this.inflight = null
    this.again = false
    this.lastPollAt = 0
    this.activeAt = 0
    this.lastError = null
    if (!email) {
      this.current = SIGNED_OUT
      this.deps.emit({ state: this.current, fresh: [] })
      return Promise.resolve(this.current)
    }
    this.current = { ...SIGNED_OUT, status: 'ready', email }
    this.deps.emit({ state: this.current, fresh: [] })
    return this.poll()
  }

  /** 检查一次新回复。同一时间只发一个请求；检查期间又有人要求检查，就在这次结束后再来一次 */
  poll(): Promise<FeedbackState> {
    if (!this.current.email) return Promise.resolve(this.current)
    if (this.inflight) {
      this.again = true
      return this.inflight
    }
    const run = this.run().finally(() => {
      if (this.inflight === run) this.inflight = null
    })
    this.inflight = run
    return run
  }

  private async run(): Promise<FeedbackState> {
    const epoch = this.epoch
    const email = this.current.email
    if (!email) return this.current
    this.lastPollAt = this.now()
    let list: FeedbackList | null = null
    let failure: Failure | null = null
    try {
      list = await this.deps.list()
    } catch (e) {
      failure = e as Failure
    }
    if (epoch !== this.epoch) return this.current // 期间退出或换了账号
    if (list) this.apply(email, list)
    else this.fail(failure ?? {})
    if (this.again) {
      this.again = false
      this.inflight = null
      return this.poll()
    }
    return this.current
  }

  private apply(email: string, list: FeedbackList): void {
    this.lastError = null
    const notified = this.deps.store.get(email)
    // 未读的团队回复，且这个版本的回复还没提醒过
    const fresh: FeedbackSummary[] = list.threads.filter(t => t.unread && notified[t.id] !== t.updatedAt)
    this.current = {
      status: 'ready',
      email,
      unreadCount: list.unreadCount,
      threads: list.threads,
      nextBefore: list.nextBefore,
      error: null,
      checkedAt: this.now(),
    }
    // 先推给窗口，再记下已提醒（推送过程出错不会漏提醒到记录里）
    this.deps.emit({ state: this.current, fresh })
    if (fresh.length) this.deps.store.record(email, Object.fromEntries(fresh.map(t => [t.id, t.updatedAt])))
  }

  private fail(e: Failure): void {
    if (e.code === 'AUTH_EXPIRED') return // 账号状态会变成未登录，由 setAccount 收尾
    const message = e.message || '检查反馈失败'
    const key = `${e.code ?? ''}:${message}`
    if (key !== this.lastError) {
      this.lastError = key
      this.deps.onError?.({ code: e.code ?? null, message })
    }
    if (e.code === 'NOT_DEPLOYED') {
      this.current = {
        ...this.current,
        status: 'not-deployed',
        unreadCount: 0,
        threads: [],
        nextBefore: null,
        error: null,
        checkedAt: this.now(),
      }
    } else {
      this.current = { ...this.current, status: 'error', error: message, checkedAt: this.now() }
    }
    this.deps.emit({ state: this.current, fresh: [] })
  }
}
