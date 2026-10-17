import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountRefreshResult } from '../../../../shared/types/account'
import { PaymentWatch, WATCH_DURATION_MS, WATCH_INTERVAL_MS } from './paymentWatch'

// 付款后的到账检测：前 2 分钟每 15 秒自动刷新，变化即停；手动刷新给出对比、暂未到账或错误。

const account = (balance: number | null, planName: string | null = null) => ({
  balance,
  plan: planName ? { name: planName, expiresAt: null, daily: null, weekly: null, monthly: null } : null,
})
const ok = (balance: number | null, planName: string | null = null): AccountRefreshResult => ({
  error: null,
  account: {
    email: 'a@b.c',
    name: 'a',
    currency: 'USD',
    group: null,
    rateLimits: [],
    updatedAt: 1,
    ...account(balance, planName),
  },
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** 依次返回 results（最后一个一直重复）；Error 表示刷新函数本身抛错 */
function make(results: Array<AccountRefreshResult | Error>) {
  const queue = [...results]
  const refresh = vi.fn(async (): Promise<AccountRefreshResult> => {
    const next = queue.length > 1 ? queue.shift()! : queue[0]
    if (next instanceof Error) throw next
    return next
  })
  return { refresh, watch: new PaymentWatch(refresh) }
}

describe('自动轮询', () => {
  it('每 15 秒刷新一次，2 分钟共 8 次后自己停', async () => {
    const { watch, refresh } = make([ok(10)])
    watch.begin(account(10))
    expect(watch.getState().watching).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1) // 打开时先强制刷新一次拿新基准
    await vi.advanceTimersByTimeAsync(WATCH_INTERVAL_MS - 1)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(WATCH_DURATION_MS * 3)
    expect(refresh).toHaveBeenCalledTimes(1 + WATCH_DURATION_MS / WATCH_INTERVAL_MS)
    // 2 分钟没到账：留下「暂未到账」，不让提示消失
    expect(watch.getState()).toMatchObject({ watching: false, outcome: { kind: 'pending' }, error: null })
  })

  it('余额变了就报到账并停止轮询', async () => {
    const { watch, refresh } = make([ok(10), ok(10), ok(35)])
    watch.begin(account(10))
    await vi.advanceTimersByTimeAsync(WATCH_INTERVAL_MS * 5)
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(watch.getState()).toMatchObject({
      watching: false,
      outcome: { kind: 'arrived', change: { balance: { from: 10, to: 35 } } },
    })
  })

  it('自动刷新失败不打扰界面，下一次照常', async () => {
    const { watch } = make([ok(10), { error: '网络错误：x', account: null }, ok(10, 'Pro')])
    watch.begin(account(10))
    await vi.advanceTimersByTimeAsync(WATCH_INTERVAL_MS)
    expect(watch.getState().error).toBeNull()
    await vi.advanceTimersByTimeAsync(WATCH_INTERVAL_MS)
    expect(watch.getState().outcome).toMatchObject({ kind: 'arrived', change: { plan: { from: null, to: 'Pro' } } })
  })

  it('stop（离开商店页）后不再刷新', async () => {
    const { watch, refresh } = make([ok(10)])
    watch.begin(account(10))
    await vi.advanceTimersByTimeAsync(WATCH_INTERVAL_MS) // 基准刷新 + 第一次轮询
    watch.stop()
    await vi.advanceTimersByTimeAsync(WATCH_DURATION_MS)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(watch.getState().watching).toBe(false)
  })

  it('stop 时在途的结果作废', async () => {
    let release!: (r: AccountRefreshResult) => void
    const refresh = vi.fn(() => new Promise<AccountRefreshResult>(resolve => (release = resolve)))
    const watch = new PaymentWatch(refresh)
    watch.begin(account(10))
    await vi.advanceTimersByTimeAsync(WATCH_INTERVAL_MS)
    watch.stop()
    release(ok(99))
    await vi.advanceTimersByTimeAsync(0)
    expect(watch.getState().outcome).toBeNull()
  })

  it('再次打开支付页：重新以当前余额为基准、重新计时', async () => {
    const { watch, refresh } = make([ok(10)])
    watch.begin(account(10))
    await vi.advanceTimersByTimeAsync(WATCH_DURATION_MS)
    expect(watch.getState().watching).toBe(false)
    watch.begin(account(10))
    expect(watch.getState().watching).toBe(true)
    const before = refresh.mock.calls.length
    await vi.advanceTimersByTimeAsync(WATCH_INTERVAL_MS)
    expect(refresh.mock.calls.length).toBe(before + 1)
  })
})

describe('基准与方向', () => {
  it('打开时缓存的余额是旧的：以强制刷新拿到的新数据为基准，之后会话扣费不算到账', async () => {
    const { watch } = make([ok(5), ok(4.98)])
    watch.begin(account(10)) // 缓存里是 10，实际已被会话扣到 5
    await vi.advanceTimersByTimeAsync(WATCH_INTERVAL_MS)
    expect(watch.getState().outcome).toBeNull()
    expect(watch.getState().watching).toBe(true)
  })
  it('拿不到新基准时用缓存，余额减少仍不算到账，增加才算', async () => {
    const { watch } = make([{ error: '网络错误：x', account: null }, ok(9.98), ok(30)])
    watch.begin(account(10))
    await vi.advanceTimersByTimeAsync(WATCH_INTERVAL_MS)
    expect(watch.getState().outcome).toBeNull()
    await vi.advanceTimersByTimeAsync(WATCH_INTERVAL_MS)
    expect(watch.getState().outcome).toMatchObject({ kind: 'arrived', change: { balance: { from: 10, to: 30 } } })
  })
  it('打开时那次刷新返回前就到账（$10 → $35）：直接算到账，不拿到账后的余额当基准', async () => {
    let release!: (r: AccountRefreshResult) => void
    const refresh = vi
      .fn<() => Promise<AccountRefreshResult>>()
      .mockImplementationOnce(() => new Promise(resolve => (release = resolve)))
      .mockResolvedValue(ok(35))
    const watch = new PaymentWatch(refresh)
    watch.begin(account(10))
    release(ok(35)) // 首次查询暂缓，到账后才返回 $35
    await vi.advanceTimersByTimeAsync(0)
    expect(watch.getState()).toMatchObject({
      watching: false,
      outcome: { kind: 'arrived', change: { balance: { from: 10, to: 35 } } },
    })
    // 之后手动刷新、等自动查询都不会变回「暂未到账」，也不再轮询
    await watch.manual()
    await vi.advanceTimersByTimeAsync(WATCH_INTERVAL_MS * 2)
    expect(watch.getState().outcome).toMatchObject({ kind: 'arrived', change: { balance: { from: 10, to: 35 } } })
    expect(refresh).toHaveBeenCalledTimes(2) // 基准刷新 + 一次手动
  })
  it('打开时那次刷新就看到套餐开通 / 续期：算到账', async () => {
    const { watch } = make([ok(10, 'Pro')])
    watch.begin(account(10))
    await vi.advanceTimersByTimeAsync(0)
    expect(watch.getState().outcome).toMatchObject({ kind: 'arrived', change: { plan: { from: null, to: 'Pro' } } })
  })
  it('对照：基准刷新先回 $35、之后涨到 $60：以 $35 为基准报 $35 → $60', async () => {
    const { watch } = make([ok(35), ok(60)])
    watch.begin(account(35))
    await vi.advanceTimersByTimeAsync(0)
    expect(watch.getState().outcome).toBeNull()
    await watch.manual()
    expect(watch.getState().outcome).toMatchObject({ kind: 'arrived', change: { balance: { from: 35, to: 60 } } })
  })
  it('套餐失效不算到账', async () => {
    const { watch } = make([ok(10, 'Pro'), ok(10, null)])
    watch.begin(account(10, 'Pro'))
    await vi.advanceTimersByTimeAsync(WATCH_INTERVAL_MS)
    expect(watch.getState().outcome).toBeNull()
  })
})

describe('手动刷新', () => {
  it('没变化：暂未到账', async () => {
    const { watch } = make([ok(10)])
    watch.begin(account(10))
    await watch.manual()
    expect(watch.getState()).toMatchObject({ refreshing: false, outcome: { kind: 'pending' }, error: null })
  })

  it('有变化：前后对比；之后再点不会把到账结果换成暂未到账', async () => {
    const { watch } = make([ok(10), ok(35)])
    watch.begin(account(10))
    await watch.manual()
    expect(watch.getState().outcome).toMatchObject({ kind: 'arrived', change: { balance: { from: 10, to: 35 } } })
    await watch.manual()
    expect(watch.getState().outcome?.kind).toBe('arrived')
  })

  it('刷新失败：显示错误，不报暂未到账；下次成功后错误清掉', async () => {
    const { watch } = make([ok(10), { error: '网络错误：offline', account: null }, ok(10)])
    watch.begin(account(10))
    await watch.manual()
    expect(watch.getState()).toMatchObject({ error: '网络错误：offline', outcome: null, refreshing: false })
    await watch.manual()
    expect(watch.getState()).toMatchObject({ error: null, outcome: { kind: 'pending' } })
  })

  it('刷新函数本身抛错也按失败显示', async () => {
    const { watch } = make([new Error('boom')])
    watch.begin(account(10))
    await watch.manual()
    expect(watch.getState().error).toBe('boom')
  })

  it('进行中不重复触发；订阅者收到通知', async () => {
    const { watch, refresh } = make([ok(10)])
    const seen = vi.fn()
    watch.subscribe(seen)
    watch.begin(account(10))
    const first = watch.manual()
    void watch.manual()
    await first
    expect(refresh).toHaveBeenCalledTimes(2) // 基准刷新 + 一次手动
    expect(seen).toHaveBeenCalled()
  })
})
