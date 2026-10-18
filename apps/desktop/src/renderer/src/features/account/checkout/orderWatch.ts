// 软件内付款的订单轮询（docs/ui/in-app-payment.md §6.4）：按订单状态查，结果是确定的，不像 paymentWatch 靠余额变化猜。
// 纯 TypeScript，不依赖 React 和 DOM：定时器、时钟、查单函数、前后台判断都可以替换，方便测试。
import type { CheckoutOrder } from '../../../../../shared/types/account'
import { isFinalStatus, remainingMs } from './checkoutLogic'

/** 二维码出现后的前 2 分钟每 3 秒查一次，之后每 10 秒 */
export const FAST_INTERVAL_MS = 3_000
export const FAST_DURATION_MS = 2 * 60_000
export const SLOW_INTERVAL_MS = 10_000
/** 窗口不在前台（document.hidden 或失去焦点）：30 秒；回到前台马上查一次 */
export const HIDDEN_INTERVAL_MS = 30_000
/** 已付款之后：每 2 秒查，最多 2 分钟，之后 10 秒 */
export const PAID_INTERVAL_MS = 2_000
export const PAID_FAST_DURATION_MS = 2 * 60_000
/** 连续这么多次失败才报错（之前只提示「网络不稳定，正在重试」） */
export const MAX_FAILURES = 5

export interface OrderWatchState {
  order: CheckoutOrder
  /** 收到 order 时的本机时刻（毫秒），倒计时用：剩余 = expires_at − server_time − (现在 − receivedAt) */
  receivedAt: number
  /** 连续失败次数（1–4：提示「网络不稳定，正在重试」） */
  failures: number
  /** 连续失败 MAX_FAILURES 次后的最后一个错误；这时轮询已停，retry() 重新开始 */
  error: unknown
  /** 轮询是否还在跑 */
  active: boolean
}

export interface OrderWatchDeps {
  fetch: (orderId: number) => Promise<CheckoutOrder>
  /** 窗口是否在前台；缺省当作在前台 */
  foreground?: () => boolean
  /** 本机时钟（毫秒）；缺省 Date.now */
  now?: () => number
}

export class OrderWatch {
  private snapshot: OrderWatchState | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private busy = false
  /** start / adopt / stop 都会加一：让还在途中的查询结果作废 */
  private gen = 0
  /** 二维码出现的时刻 / 第一次看到「已付款」的时刻（本机时钟） */
  private startedAt = 0
  private paidAt: number | null = null
  private readonly listeners = new Set<() => void>()
  private readonly now: () => number
  private readonly foreground: () => boolean

  constructor(private readonly deps: OrderWatchDeps) {
    this.now = deps.now ?? Date.now
    this.foreground = deps.foreground ?? (() => true)
  }

  getState = (): OrderWatchState | null => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(next: OrderWatchState | null): void {
    this.snapshot = next
    for (const l of this.listeners) l()
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  /** 二维码出现：以这笔订单开始轮询（已经是终态就只记下来，不轮询） */
  start(order: CheckoutOrder): void {
    this.gen++
    this.busy = false
    this.clearTimer()
    this.startedAt = this.now()
    this.paidAt = null
    this.take(order, 0)
  }

  /** 核实 / 取消返回了新的订单状态：采用它，必要时重新开始轮询（比如过期的单核实后其实已付） */
  adopt(order: CheckoutOrder): void {
    this.gen++
    this.busy = false
    this.clearTimer()
    if (!this.snapshot || this.snapshot.order.orderId !== order.orderId) {
      this.startedAt = this.now()
      this.paidAt = null
    }
    this.take(order, 0)
  }

  /** 弹窗关闭：停止，在途的结果作废；订单状态保留 */
  stop(): void {
    this.gen++
    this.busy = false
    this.clearTimer()
    if (this.snapshot?.active) this.set({ ...this.snapshot, active: false })
  }

  /** 连续失败后的「重试」：马上查一次，之后照常 */
  retry(): void {
    const s = this.snapshot
    if (!s || isFinalStatus(s.order.status)) return
    this.gen++
    this.busy = false
    this.clearTimer()
    this.set({ ...s, failures: 0, error: null, active: true })
    this.beat()
  }

  /** 窗口前后台变了：回到前台马上查一次，其余只是换一个节奏 */
  foregroundChanged(): void {
    const s = this.snapshot
    if (!s?.active) return
    if (this.foreground()) this.beat()
    else this.arm()
  }

  /** 采用一份订单：终态不轮询；否则按当前状态排下一拍 */
  private take(order: CheckoutOrder, failures: number): void {
    const now = this.now()
    if (order.status === 'paid' && this.paidAt === null) this.paidAt = now
    const active = !isFinalStatus(order.status)
    this.set({ order, receivedAt: now, failures, error: null, active })
    if (active) this.arm()
  }

  /** 下一拍等多久：3 秒 → 10 秒；已付款 2 秒；不在前台 30 秒；待付单到 expires_at 时再查一次 */
  private delay(s: OrderWatchState): number {
    const now = this.now()
    let ms: number
    if (!this.foreground()) ms = HIDDEN_INTERVAL_MS
    else if (s.order.status === 'paid')
      ms = this.paidAt !== null && now - this.paidAt < PAID_FAST_DURATION_MS ? PAID_INTERVAL_MS : SLOW_INTERVAL_MS
    else ms = now - this.startedAt < FAST_DURATION_MS ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS
    if (s.order.status === 'pending') ms = Math.min(ms, Math.max(0, remainingMs(s.order, s.receivedAt, now)))
    return ms
  }

  private arm(): void {
    this.clearTimer()
    const s = this.snapshot
    if (!s?.active) return
    this.timer = setTimeout(() => this.beat(), this.delay(s))
  }

  /** 一拍：先排好下一拍；上一次查询还没回来就跳过这一拍 */
  private beat(): void {
    const s = this.snapshot
    if (!s?.active) return
    this.arm()
    if (this.busy) return
    this.busy = true
    const gen = this.gen
    this.deps.fetch(s.order.orderId).then(
      order => {
        if (gen !== this.gen) return
        this.busy = false
        this.arrived(order)
      },
      (error: unknown) => {
        if (gen !== this.gen) return
        this.busy = false
        this.failed(error)
      },
    )
  }

  private arrived(order: CheckoutOrder): void {
    const before = this.snapshot
    const now = this.now()
    if (order.status === 'paid' && this.paidAt === null) this.paidAt = now
    // 待付单查到了 expires_at 之后仍是待付：最后这一次查过了，停（弹窗按到期显示「已过期」，「我已付款」照样能核实）
    const lapsed = order.status === 'pending' && remainingMs(order, now, now) <= 0
    const active = !isFinalStatus(order.status) && !lapsed
    this.set({ order, receivedAt: now, failures: 0, error: null, active })
    if (!active) {
      this.clearTimer()
      return
    }
    // 状态变了（待付 → 已付款）节奏跟着变，重新排下一拍
    if (before?.order.status !== order.status) this.arm()
  }

  private failed(error: unknown): void {
    const s = this.snapshot
    if (!s) return
    const failures = s.failures + 1
    if (failures >= MAX_FAILURES) {
      this.clearTimer()
      this.set({ ...s, failures, error, active: false })
    } else {
      this.set({ ...s, failures })
    }
  }
}
