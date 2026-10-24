import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountQuota } from '@pixelsky/protocol'

const NOW = new Date(2026, 9, 19, 14, 32).getTime()

beforeEach(() => {
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const sample = (over: Partial<AccountQuota> = {}): AccountQuota => ({
  provider: 'claude',
  status: 'ok',
  plan: 'max',
  account: 'linxia@example.com',
  windows: [{ id: 'five_hour', durationMins: 300, usedPercent: 42, resetsAt: NOW + 3_600_000 }],
  extras: {},
  blocked: null,
  observedAt: NOW,
  fetchedAt: NOW,
  source: 'usage',
  refreshable: true,
  error: null,
  ...over,
})

describe('存储（没有桥）', () => {
  it('window.pixelsky.quota 不存在：不崩，没有数据', async () => {
    vi.stubGlobal('window', {})
    const store = await import('./quotaStore')
    await expect(store.ensureQuota('claude')).resolves.toBeUndefined()
    await expect(store.peekQuota('claude')).resolves.toBeUndefined()
    await expect(store.refreshQuota('claude', { force: true })).resolves.toBe(false)
    expect(store.getQuota('claude')).toBeNull()
  })
})

describe('存储（有桥）', () => {
  function bridge(initial: AccountQuota | null, refreshed: AccountQuota) {
    let push: (q: AccountQuota) => void = () => undefined
    const quota = {
      get: vi.fn(async (_provider?: string): Promise<AccountQuota | null> => initial),
      refresh: vi.fn(async () => refreshed),
      onChange: vi.fn((cb: (q: AccountQuota) => void) => {
        push = cb
        return () => undefined
      }),
    }
    vi.stubGlobal('window', { pixelsky: { quota } })
    return { quota, push: (q: AccountQuota) => push(q) }
  }
  it('第一次显示：没有缓存就读一次（maxAgeMs 10 分钟），读完存起来', async () => {
    const fresh = sample({ fetchedAt: Date.now() })
    const { quota } = bridge(null, fresh)
    const store = await import('./quotaStore')
    await store.ensureQuota('claude')
    expect(quota.get).toHaveBeenCalledWith('claude')
    expect(quota.refresh).toHaveBeenCalledWith('claude', { maxAgeMs: 10 * 60_000 })
    expect(store.getQuota('claude')).toBe(fresh)
  })
  it('缓存还新（10 分钟内读过）就不再读', async () => {
    const { quota } = bridge(sample({ fetchedAt: Date.now() - 60_000 }), sample())
    const store = await import('./quotaStore')
    await store.ensureQuota('claude')
    expect(quota.refresh).not.toHaveBeenCalled()
  })
  it('缓存超过 10 分钟：再读', async () => {
    const { quota } = bridge(sample({ fetchedAt: Date.now() - 11 * 60_000 }), sample())
    const store = await import('./quotaStore')
    await store.ensureQuota('claude')
    expect(quota.refresh).toHaveBeenCalledTimes(1)
  })
  it('quota:changed 推来的快照按 provider 写进去；平台的不收', async () => {
    const { push } = bridge(null, sample())
    const store = await import('./quotaStore')
    await store.ensureQuota('claude')
    const next = sample({ windows: [{ id: 'five_hour', durationMins: 300, usedPercent: 91, resetsAt: null }] })
    push(next)
    expect(store.getQuota('claude')).toBe(next)
    push({ ...next, provider: 'platform' })
    expect(store.getQuota('claude')).toBe(next)
  })
  it('主进程推来「读取中」（登录 / 换账号后清掉了旧记录）：显示读取中，读完的快照推来后不再读取中', async () => {
    const { push } = bridge(null, sample())
    const store = await import('./quotaStore')
    await store.ensureQuota('claude', 'linxia@example.com')
    push(sample({ status: 'empty', windows: [], fetchedAt: null, pending: true }))
    expect(store.getQuota('claude')?.status).toBe('empty')
    expect(store.quotaLoading('claude')).toBe(true)
    push(sample())
    expect(store.getQuota('claude')?.status).toBe('ok')
    expect(store.quotaLoading('claude')).toBe(false)
  })
  it('手动刷新返回是否成功：失败快照返回 false', async () => {
    const failed = sample({ status: 'error', error: { code: 'network', message: 'x' } })
    bridge(null, failed)
    const store = await import('./quotaStore')
    await expect(store.refreshQuota('claude', { force: true })).resolves.toBe(false)
    expect(store.getQuota('claude')).toBe(failed)
  })
  it('桥抛错也不崩', async () => {
    const { quota } = bridge(null, sample())
    quota.refresh.mockRejectedValue(new Error('boom'))
    const store = await import('./quotaStore')
    await expect(store.refreshQuota('chatgpt')).resolves.toBe(false)
  })
  it('换了账号：旧账号的数据被丢掉，重新读主进程（不靠组件）', async () => {
    const { quota } = bridge(sample({ account: 'a@example.com', fetchedAt: Date.now() }), sample())
    const store = await import('./quotaStore')
    await store.ensureQuota('claude', 'a@example.com')
    expect(store.getQuota('claude')?.account).toBe('a@example.com')
    // 换成 b：组件卸载再挂上（asked 已 true、旧快照不到 10 分钟）也要认出来
    quota.get.mockResolvedValueOnce(sample({ account: 'b@example.com', fetchedAt: Date.now() }))
    await store.ensureQuota('claude', 'b@example.com')
    expect(quota.get).toHaveBeenCalledTimes(2)
    expect(store.getQuota('claude')?.account).toBe('b@example.com')
  })
  it('换了账号而主进程还没有新账号的缓存：旧数据不保留，读取一次', async () => {
    const { quota } = bridge(
      sample({ account: 'a@example.com', fetchedAt: Date.now() }),
      sample({ account: 'b@example.com' }),
    )
    const store = await import('./quotaStore')
    await store.ensureQuota('claude', 'a@example.com')
    quota.get.mockResolvedValueOnce(null)
    await store.ensureQuota('claude', 'b@example.com')
    expect(quota.refresh).toHaveBeenCalledTimes(1)
    expect(store.getQuota('claude')?.account).toBe('b@example.com')
  })
  it('旧账号的快照推过来 / 读回来：不收', async () => {
    const { push } = bridge(null, sample({ account: 'a@example.com' }))
    const store = await import('./quotaStore')
    store.noteAccount('claude', 'b@example.com')
    await store.ensureQuota('claude', 'b@example.com') // 读回来的是 a 的：丢掉
    expect(store.getQuota('claude')).toBeNull()
    push(sample({ account: 'a@example.com' }))
    expect(store.getQuota('claude')).toBeNull()
    const mine = sample({ account: 'B@Example.com' }) // 邮箱忽略大小写
    push(mine)
    expect(store.getQuota('claude')).toBe(mine)
  })
  it('账号从邮箱变成 null（退出登录）、从 null 变成邮箱：都算换了账号', async () => {
    const { quota } = bridge(sample({ account: 'a@example.com', fetchedAt: Date.now() }), sample())
    const store = await import('./quotaStore')
    await store.ensureQuota('claude', 'a@example.com')
    store.noteAccount('claude', null)
    expect(store.getQuota('claude')).toBeNull()
    quota.get.mockResolvedValue(sample({ account: null, fetchedAt: Date.now() }))
    await store.ensureQuota('claude', null)
    expect(store.getQuota('claude')?.account).toBeNull()
    store.noteAccount('claude', 'a@example.com')
    expect(store.getQuota('claude')).toBeNull()
  })
  it('账号没变：不重复读（缓存还新）', async () => {
    const { quota } = bridge(sample({ fetchedAt: Date.now() }), sample())
    const store = await import('./quotaStore')
    await store.ensureQuota('claude', 'linxia@example.com')
    await store.ensureQuota('claude', 'linxia@example.com')
    expect(quota.get).toHaveBeenCalledTimes(1)
    expect(quota.refresh).not.toHaveBeenCalled()
  })
  it('Claude 和 ChatGPT 之间切换：各存各的，谁也不清谁', async () => {
    const claude = sample({ account: 'a@example.com', fetchedAt: Date.now() })
    const chatgpt = sample({ provider: 'chatgpt', account: 'a@example.com', fetchedAt: Date.now() })
    const { quota } = bridge(null, claude)
    quota.get.mockImplementation(async (p?: string) => (p === 'claude' ? claude : chatgpt))
    const store = await import('./quotaStore')
    await store.ensureQuota('claude', 'a@example.com')
    await store.ensureQuota('chatgpt', 'a@example.com')
    await store.ensureQuota('claude', 'a@example.com')
    expect(store.getQuota('claude')).toBe(claude)
    expect(store.getQuota('chatgpt')).toBe(chatgpt)
    expect(quota.get).toHaveBeenCalledTimes(2) // 切回 claude 不再读，也没丢
    expect(quota.refresh).not.toHaveBeenCalled()
  })
})
