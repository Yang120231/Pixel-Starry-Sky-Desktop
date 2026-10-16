import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtStoreCatalogPage } from '@pixelsky/protocol'
import { fakeExtStoreBridge, fakeStoreItem } from './testing'

// node 环境：每条用例重新加载 store.ts（它的状态是模块级单例），按需要给 globalThis 放一个带桥的 window

type G = { window?: unknown }
const g = globalThis as G

afterEach(() => {
  delete g.window
  vi.resetModules()
  vi.useRealTimers()
})

async function load(bridge?: ReturnType<typeof fakeExtStoreBridge>) {
  vi.resetModules()
  if (bridge) g.window = { pixelsky: { extstore: bridge } }
  else delete g.window
  return import('./store')
}

describe('extstore store（无 window）', () => {
  it('导入没有副作用，取到的是空状态，调用不抛错', async () => {
    const store = await load()
    const snap = store.getExtStore()
    expect(snap.state.updates).toEqual({})
    expect(snap.state.blocklistAt).toBeNull()
    expect(() => store.touchExtStore()).not.toThrow()
    await expect(store.fetchCatalog({})).rejects.toThrow()
    expect(await store.installExtension('a.b', '1.0.0')).toBe(false)
  })
})

describe('extstore store（有桥）', () => {
  it('导入时什么都不调；第一次取状态时 refreshBlocklist 被调 1 次，再取不重复调', async () => {
    const refreshBlocklist = vi.fn(async () => ({ blocklistAt: '2026-10-17T00:00:00Z' }))
    const state = vi.fn(async () => ({ site: 'https://x.test', updates: {}, blocklistAt: null, installing: {} }))
    const onChange = vi.fn(() => () => {})
    const store = await load(fakeExtStoreBridge({ refreshBlocklist, state, onChange }))
    expect(refreshBlocklist).not.toHaveBeenCalled()
    expect(state).not.toHaveBeenCalled()

    store.getExtStore()
    expect(refreshBlocklist).toHaveBeenCalledTimes(1)
    expect(state).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    store.getExtStore()
    store.subscribeExtStore(() => {})()
    expect(refreshBlocklist).toHaveBeenCalledTimes(1)

    await vi.waitFor(() => expect(store.getExtStore().state.blocklistAt).toBe('2026-10-17T00:00:00Z'))
  })

  it('打开扩展页时：停用名单 5 分钟内不重复读；距上次查更新超过 10 分钟才再查', async () => {
    const refreshBlocklist = vi.fn(async () => ({ blocklistAt: null }))
    const checkUpdates = vi.fn(async () => ({ 'a.b': { latest: '2.0.0', engineOk: true } }))
    const store = await load(fakeExtStoreBridge({ refreshBlocklist, checkUpdates }))
    const t0 = Date.now()
    store.touchExtStore(t0)
    await vi.waitFor(() => expect(checkUpdates).toHaveBeenCalledTimes(1))
    expect(refreshBlocklist).toHaveBeenCalledTimes(1)
    expect(store.getExtStore().state.updates['a.b']?.latest).toBe('2.0.0')

    // 4 分钟后再打开：名单不读；5 分钟后才再读
    store.touchBlocklist(t0 + 4 * 60_000)
    expect(refreshBlocklist).toHaveBeenCalledTimes(1)
    store.touchBlocklist(t0 + 5 * 60_000)
    expect(refreshBlocklist).toHaveBeenCalledTimes(2)

    store.touchUpdates(t0 + 9 * 60_000)
    expect(checkUpdates).toHaveBeenCalledTimes(1)
    store.touchUpdates(t0 + 10 * 60_000 + 1000)
    await vi.waitFor(() => expect(checkUpdates).toHaveBeenCalledTimes(2))
  })

  it('读停用名单失败时不抛、不影响别的', async () => {
    const store = await load(
      fakeExtStoreBridge({
        refreshBlocklist: async () => {
          throw new Error('offline')
        },
      }),
    )
    expect(() => store.getExtStore()).not.toThrow()
    await new Promise(r => setTimeout(r, 0))
    expect(store.getExtStore().state.blocklistAt).toBeNull()
  })

  it('安装失败时记下翻成当前语言的原因，再点安装时清掉', async () => {
    let fail = true
    const install = vi.fn(async () => {
      if (fail) throw new Error('errors.extstore.offline')
      return {} as never
    })
    const store = await load(fakeExtStoreBridge({ install }))
    expect(await store.installExtension('a.b', '1.0.0')).toBe(false)
    expect(store.getExtStore().installErrors['a.b']).toBeTruthy()
    fail = false
    expect(await store.installExtension('a.b', '1.0.0')).toBe(true)
    expect(store.getExtStore().installErrors['a.b']).toBeUndefined()
  })
})

describe('发现页的浏览位置', () => {
  it('saveDiscoverView 后再取，搜索词、分类、排序、页、scrollTop 都一样', async () => {
    const store = await load()
    expect(store.discoverView()).toEqual(store.DEFAULT_DISCOVER_VIEW)
    const pages: ExtStoreCatalogPage[] = [
      { items: [fakeStoreItem({ id: 'a.a' })], nextBefore: '30' },
      { items: [fakeStoreItem({ id: 'b.b' })], nextBefore: null },
    ]
    store.saveDiscoverView({ q: 'swift', category: 'grammars', sort: 'downloads', pages, scrollTop: 480 })
    const back = store.discoverView()
    expect(back).toMatchObject({ q: 'swift', category: 'grammars', sort: 'downloads', scrollTop: 480 })
    expect(back.pages).toEqual(pages)
  })
})
