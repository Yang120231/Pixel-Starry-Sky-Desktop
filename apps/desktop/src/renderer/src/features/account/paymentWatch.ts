// 付款后的到账检测（docs/ui/settings.md §9.4）：打开支付页后，前 2 分钟每 15 秒刷新一次账号，
// 余额 / 套餐比打开时有变化就算到账并停止；「我已付款，刷新」是随时可点的手动检查。
// 纯 TypeScript，不依赖 React，定时器和刷新函数都可以替换，方便测试。
import type { AccountInfo, AccountRefreshResult } from '../../../../shared/types/account'
import { diffAccount, snapOf, type AccountChange, type AccountSnap } from './storeLogic'

export const WATCH_INTERVAL_MS = 15_000
export const WATCH_DURATION_MS = 2 * 60_000

export type WatchOutcome = { kind: 'arrived'; change: AccountChange } | { kind: 'pending' }

export interface WatchState {
  /** 正在自动轮询 */
  watching: boolean
  /** 手动刷新进行中 */
  refreshing: boolean
  outcome: WatchOutcome | null
  /** 手动刷新失败的原因（宿主文案，显示时用 translateMessage） */
  error: string | null
}

const IDLE: WatchState = { watching: false, refreshing: false, outcome: null, error: null }

export class PaymentWatch {
  private snapshot: WatchState = IDLE
  private baseline: AccountSnap | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private ticks = 0
  private autoBusy = false
  /** begin / stop 都会加一：让还在途中的刷新结果作废 */
  private gen = 0
  private readonly listeners = new Set<() => void>()
  private readonly maxTicks: number

  constructor(
    private readonly refresh: () => Promise<AccountRefreshResult>,
    private readonly intervalMs = WATCH_INTERVAL_MS,
    durationMs = WATCH_DURATION_MS,
  ) {
    this.maxTicks = Math.max(1, Math.round(durationMs / intervalMs))
  }

  getState = (): WatchState => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(patch: Partial<WatchState>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const l of this.listeners) l()
  }

  private clearTimer(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * 支付页刚打开：先以缓存的账号数据为基准，并马上强制刷新一次。新数据比缓存少（缓存可能是几分钟前的，
   * 期间被会话扣掉的部分不能算成到账）就换成新基准；比缓存多（这次刷新返回前就到账了）直接算到账，
   * 不能拿它当基准，否则之后一直和到账后的自己比、永远「暂未到账」。拿不到新数据就继续用缓存。
   * 然后开始自动轮询（重复打开会重新计时）
   */
  begin(account: Pick<AccountInfo, 'balance' | 'plan'>): void {
    this.clearTimer()
    this.gen++
    this.baseline = snapOf(account)
    this.ticks = 0
    this.autoBusy = false
    this.snapshot = { watching: true, refreshing: false, outcome: null, error: null }
    for (const l of this.listeners) l()
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
    void this.refreshBaseline(this.gen)
  }

  private async refreshBaseline(gen: number): Promise<void> {
    try {
      const res = await this.refresh()
      if (gen !== this.gen || res.error || !res.account || this.snapshot.outcome?.kind === 'arrived') return
      const fresh = snapOf(res.account)
      const change = this.baseline ? diffAccount(this.baseline, fresh) : null
      if (change) this.arrive(change)
      else this.baseline = fresh
    } catch {
      /* 拿不到就用缓存的基准 */
    }
  }

  /** 停止自动轮询（离开商店页）；已有的结果保留 */
  stop(): void {
    this.clearTimer()
    this.gen++
    this.autoBusy = false
    if (this.snapshot.watching || this.snapshot.refreshing) this.set({ watching: false, refreshing: false })
  }

  private async tick(): Promise<void> {
    if (this.autoBusy) return
    this.ticks++
    const last = this.ticks >= this.maxTicks
    if (last) {
      this.clearTimer()
      this.set({ watching: false })
    }
    this.autoBusy = true
    const gen = this.gen
    try {
      await this.check(gen, false)
      // 自动检查结束仍没到账：留下「暂未到账」，不让提示直接消失
      if (last && gen === this.gen && !this.snapshot.outcome) this.set({ outcome: { kind: 'pending' } })
    } finally {
      if (gen === this.gen) this.autoBusy = false
    }
  }

  /** 「我已付款，刷新」：失败显示错误；没变化显示「暂未到账」；有变化显示前后对比 */
  async manual(): Promise<void> {
    if (this.snapshot.refreshing) return
    const gen = this.gen
    this.set({ refreshing: true, error: null })
    await this.check(gen, true)
    if (gen === this.gen) this.set({ refreshing: false })
  }

  private async check(gen: number, manual: boolean): Promise<void> {
    let res: AccountRefreshResult | undefined
    try {
      res = await this.refresh()
    } catch (e) {
      res = { error: e instanceof Error ? e.message : String(e), account: null }
    }
    if (gen !== this.gen) return
    if (res?.error) {
      if (manual) this.set({ error: res.error })
      return
    }
    const change = res?.account && this.baseline ? diffAccount(this.baseline, snapOf(res.account)) : null
    if (change) this.arrive(change)
    else if (manual && this.snapshot.outcome?.kind !== 'arrived') this.set({ outcome: { kind: 'pending' } })
  }

  private arrive(change: AccountChange): void {
    this.clearTimer()
    this.set({ watching: false, outcome: { kind: 'arrived', change }, error: null })
  }
}
