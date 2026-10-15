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

describe('完全放行提示的本机共享确认', () => {
  it('关闭后，其他窗口和重新打开的窗口读取同一个确认', async () => {
    const first = await load()
    const second = await load()
    expect(first.readFullAccessStripDismissed()).toBe(false)
    first.dismissFullAccessStrip()
    expect(second.readFullAccessStripDismissed()).toBe(true)
    expect((await load()).readFullAccessStripDismissed()).toBe(true)
  })

  it.each(['ask', 'edits', 'plan'] as const)('任一窗口从完全放行切到 %s，立即全局恢复提示', async mode => {
    const first = await load()
    const second = await load()
    first.dismissFullAccessStrip()
    second.resetFullAccessStripOnModeChange('full', mode)
    expect(first.readFullAccessStripDismissed()).toBe(false)
    expect(second.readFullAccessStripDismissed()).toBe(false)
    expect((await load()).readFullAccessStripDismissed()).toBe(false)
  })

  it('重新切入完全放行也全局恢复提示', async () => {
    const first = await load()
    const second = await load()
    first.dismissFullAccessStrip()
    second.resetFullAccessStripOnModeChange('edits', 'full')
    expect(first.readFullAccessStripDismissed()).toBe(false)
    second.dismissFullAccessStrip()
    expect(first.readFullAccessStripDismissed()).toBe(true)
    first.resetFullAccessStripOnModeChange('ask', 'full')
    expect(second.readFullAccessStripDismissed()).toBe(false)
  })

  it('重复选择完全放行不清除确认', async () => {
    const store = await load()
    store.dismissFullAccessStrip()
    store.resetFullAccessStripOnModeChange('full', 'full')
    expect(store.readFullAccessStripDismissed()).toBe(true)
  })

  it('其他模式之间切换或再次选择其他模式，也会清除全局确认', async () => {
    const first = await load()
    const second = await load()
    for (const from of ['ask', 'edits', 'plan'] as const) {
      for (const to of ['ask', 'edits', 'plan'] as const) {
        first.dismissFullAccessStrip()
        second.resetFullAccessStripOnModeChange(from, to)
        expect(first.readFullAccessStripDismissed()).toBe(false)
      }
    }
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
    store.resetFullAccessStripOnModeChange('edits', 'full')
    expect(store.readFullAccessStripDismissed()).toBe(false)
  })

  it('演示模式只影响内存，不覆盖用户已有确认', async () => {
    const store = await load()
    data.set(store.FULL_ACCESS_STRIP_DISMISSED_KEY, '1')
    Object.assign(window, { pixelsky: { demo: true } })
    expect(store.readFullAccessStripDismissed()).toBe(false)
    store.dismissFullAccessStrip()
    expect(store.readFullAccessStripDismissed()).toBe(true)
    store.resetFullAccessStripOnModeChange('edits', 'full')
    expect(store.readFullAccessStripDismissed()).toBe(false)
    expect(data.get(store.FULL_ACCESS_STRIP_DISMISSED_KEY)).toBe('1')
  })
})
