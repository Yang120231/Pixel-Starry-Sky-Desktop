import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState, UpdateStatus } from '../../../../shared/types/update'

// 在没有 DOM 的测试里保留真实 store 的订阅和快照，模拟提示卸载 / 重新挂载。
const { subscriptions } = vi.hoisted(() => ({
  subscriptions: [] as Array<{
    subscribe: (listener: () => void) => () => void
    getSnapshot: () => unknown
  }>,
}))
vi.mock('react', () => ({
  useSyncExternalStore: (subscribe: (listener: () => void) => () => void, getSnapshot: () => unknown) => {
    subscriptions.push({ subscribe, getSnapshot })
    return getSnapshot()
  },
}))

const update = (status: UpdateStatus, version = '0.5.0'): UpdateState => ({
  status,
  version,
  channel: 'installed',
  beta: false,
})

async function setup(initial = update('ready')) {
  const bridge = {
    state: vi.fn(async () => initial),
    onChange: vi.fn<(listener: (state: UpdateState) => void) => void>(),
    check: vi.fn(async () => initial),
    install: vi.fn(async () => undefined),
    download: vi.fn(async () => undefined),
  }
  vi.stubGlobal('window', { pixelsky: { update: bridge } })
  const store = await import('./store')
  return {
    store,
    bridge,
    push: (state: UpdateState) => bridge.onChange.mock.calls[0][0](state),
  }
}

function observe(read: () => UpdateState | null) {
  read()
  const { subscribe, getSnapshot } = subscriptions.at(-1)!
  const listener = vi.fn()
  const unsubscribe = subscribe(listener)
  return { getSnapshot, listener, unsubscribe }
}

beforeEach(() => {
  vi.resetModules()
  subscriptions.length = 0
})
afterEach(() => vi.unstubAllGlobals())

describe('共享更新提示', () => {
  it('两个模式共用一次桥接订阅，已有更新也会在挂载后显示', async () => {
    const { store, bridge } = await setup()
    const chat = observe(store.useUpdateNoticeState)
    const code = observe(store.useUpdateNoticeState)
    expect(chat.getSnapshot()).toBeNull()
    await Promise.resolve()
    expect(chat.getSnapshot()).toEqual(update('ready'))
    expect(code.getSnapshot()).toBe(chat.getSnapshot())
    expect(chat.listener).toHaveBeenCalledOnce()
    expect(code.listener).toHaveBeenCalledOnce()
    expect(bridge.onChange).toHaveBeenCalledOnce()
    expect(bridge.state).toHaveBeenCalledOnce()
  })

  it('稍后会同步隐藏两处提示，重新挂载不重置，关于页保留完整更新状态', async () => {
    const { store } = await setup()
    const chat = observe(store.useUpdateNoticeState)
    const code = observe(store.useUpdateNoticeState)
    const about = observe(store.useUpdateState)
    await Promise.resolve()
    chat.listener.mockClear()
    code.listener.mockClear()
    store.updateActions.dismissNotice('0.5.0')
    expect(chat.getSnapshot()).toBeNull()
    expect(code.getSnapshot()).toBeNull()
    expect(chat.listener).toHaveBeenCalledOnce()
    expect(code.listener).toHaveBeenCalledOnce()
    expect(about.getSnapshot()).toEqual(update('ready'))
    chat.unsubscribe()
    code.unsubscribe()
    expect(observe(store.useUpdateNoticeState).getSnapshot()).toBeNull()
  })

  it('关闭的同版本变为 ready 仍隐藏，新版本仍提示，并记住各版本的关闭状态', async () => {
    const { store, push } = await setup(update('available'))
    const notice = observe(store.useUpdateNoticeState)
    await Promise.resolve()
    expect(notice.getSnapshot()).toEqual(update('available'))
    store.updateActions.dismissNotice('0.5.0')
    push(update('ready'))
    expect(notice.getSnapshot()).toBeNull()
    push(update('available', '0.6.0'))
    expect(notice.getSnapshot()).toEqual(update('available', '0.6.0'))
    store.updateActions.dismissNotice('0.6.0')
    push(update('ready'))
    expect(notice.getSnapshot()).toBeNull()
  })

  it('只对有版本号的 available / ready 状态显示提示', async () => {
    const { store, push } = await setup()
    const notice = observe(store.useUpdateNoticeState)
    await Promise.resolve()
    for (const status of ['idle', 'unsupported', 'checking', 'latest', 'downloading', 'error'] as const) {
      push(update(status))
      expect(notice.getSnapshot(), status).toBeNull()
    }
    push(update('available', ''))
    expect(notice.getSnapshot()).toBeNull()
    push(update('available'))
    expect(notice.getSnapshot()).toEqual(update('available'))
    push({ ...update('ready'), installing: true })
    expect(notice.getSnapshot()).toEqual({ ...update('ready'), installing: true })
  })

  it('新一次应用运行可以再次提示', async () => {
    const first = await setup()
    observe(first.store.useUpdateNoticeState)
    await Promise.resolve()
    first.store.updateActions.dismissNotice('0.5.0')
    vi.resetModules()
    const next = await setup()
    const notice = observe(next.store.useUpdateNoticeState)
    await Promise.resolve()
    expect(notice.getSnapshot()).toEqual(update('ready'))
  })

  it('浏览器预览没有桥接时不显示', async () => {
    vi.stubGlobal('window', {})
    const store = await import('./store')
    expect(observe(store.useUpdateNoticeState).getSnapshot()).toBeNull()
  })
})
