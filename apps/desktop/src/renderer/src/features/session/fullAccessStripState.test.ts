import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Store = typeof import('./fullAccessStripState')
let data: Map<string, string>

async function load(): Promise<Store> {
  vi.resetModules()
  return import('./fullAccessStripState')
}

beforeEach(() => {
  data = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  })
  vi.stubGlobal('window', new EventTarget())
})

afterEach(() => vi.unstubAllGlobals())

describe('完全放行提示条的「不再提示」', () => {
  it('关闭后，其他窗口和重新打开的窗口读取同一条记录', async () => {
    const first = await load()
    const second = await load()
    expect(first.readFullAccessStripDismissed()).toBe(false)
    first.dismissFullAccessStrip()
    expect(second.readFullAccessStripDismissed()).toBe(true)
    expect((await load()).readFullAccessStripDismissed()).toBe(true)
  })

  it('记住 30 天，过期后恢复显示', async () => {
    const store = await load()
    const now = 1_800_000_000_000
    store.setFullAccessStripDismissed(true, now)
    expect(store.readFullAccessStripDismissed(now + store.FULL_ACCESS_STRIP_DISMISS_MS - 1)).toBe(true)
    expect(store.readFullAccessStripDismissed(now + store.FULL_ACCESS_STRIP_DISMISS_MS)).toBe(false)
  })

  it('恢复显示会清除记录，所有窗口同步', async () => {
    const first = await load()
    const second = await load()
    first.dismissFullAccessStrip()
    second.setFullAccessStripDismissed(false)
    expect(first.readFullAccessStripDismissed()).toBe(false)
    expect(data.has(first.FULL_ACCESS_STRIP_DISMISSED_KEY)).toBe(false)
  })

  it('旧版的记录作废并在下次写入时清掉', async () => {
    data.set('pixelsky.fullAccess.stripDismissed', '1')
    const store = await load()
    expect(store.readFullAccessStripDismissed()).toBe(false)
    store.dismissFullAccessStrip()
    expect(data.has('pixelsky.fullAccess.stripDismissed')).toBe(false)
  })

  it('记录不是有效时间时当作没关过', async () => {
    const store = await load()
    data.set(store.FULL_ACCESS_STRIP_DISMISSED_KEY, 'abc')
    expect(store.readFullAccessStripDismissed()).toBe(false)
    data.set(store.FULL_ACCESS_STRIP_DISMISSED_KEY, '0')
    expect(store.readFullAccessStripDismissed()).toBe(false)
  })

  it('存储不可用时仍能在本窗口隐藏和恢复', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('unavailable')
      },
      setItem: () => {
        throw new Error('unavailable')
      },
      removeItem: () => {
        throw new Error('unavailable')
      },
    })
    const store = await load()
    expect(store.readFullAccessStripDismissed()).toBe(false)
    store.dismissFullAccessStrip()
    expect(store.readFullAccessStripDismissed()).toBe(true)
    store.setFullAccessStripDismissed(false)
    expect(store.readFullAccessStripDismissed()).toBe(false)
  })

  it('演示模式只影响内存，不覆盖用户已有记录', async () => {
    const store = await load()
    data.set(store.FULL_ACCESS_STRIP_DISMISSED_KEY, '1700000000000')
    Object.assign(window, { pixelsky: { demo: true } })
    expect(store.readFullAccessStripDismissed()).toBe(false)
    store.dismissFullAccessStrip()
    expect(store.readFullAccessStripDismissed()).toBe(true)
    store.setFullAccessStripDismissed(false)
    expect(store.readFullAccessStripDismissed()).toBe(false)
    expect(data.get(store.FULL_ACCESS_STRIP_DISMISSED_KEY)).toBe('1700000000000')
  })
})
