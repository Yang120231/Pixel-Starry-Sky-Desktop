import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
const listeners = new Map<string, (event: unknown) => void>()
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
}

beforeEach(() => {
  store.clear()
  listeners.clear()
  vi.resetModules()
  vi.stubGlobal('localStorage', fakeStorage)
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  })
})

const KEY = 'pixelsky.quota-display'

describe('额度按钮的显示设置', () => {
  it('默认：开、一直显示、图标和百分比', async () => {
    const m = await import('./quotaDisplay')
    expect(m.getQuotaDisplay()).toEqual({ enabled: true, when: 'always', style: 'full' })
  })
  it('坏 JSON 回到默认', async () => {
    store.set(KEY, '{not json')
    const m = await import('./quotaDisplay')
    expect(m.getQuotaDisplay()).toEqual(m.DEFAULT_QUOTA_DISPLAY)
  })
  it('单项不合法：只有那一项回到默认', async () => {
    store.set(KEY, JSON.stringify({ enabled: false, when: 'sometimes', style: 'icon' }))
    const m = await import('./quotaDisplay')
    expect(m.getQuotaDisplay()).toEqual({ enabled: false, when: 'always', style: 'icon' })
  })
  it('不是对象的 JSON', async () => {
    const m = await import('./quotaDisplay')
    expect(m.parseQuotaDisplay('42')).toEqual(m.DEFAULT_QUOTA_DISPLAY)
    expect(m.parseQuotaDisplay('null')).toEqual(m.DEFAULT_QUOTA_DISPLAY)
    expect(m.parseQuotaDisplay(null)).toEqual(m.DEFAULT_QUOTA_DISPLAY)
  })
  it('set 合并、写入 JSON、立刻生效；不合法的值被忽略', async () => {
    const m = await import('./quotaDisplay')
    m.setQuotaDisplay({ style: 'icon' })
    expect(m.getQuotaDisplay()).toEqual({ enabled: true, when: 'always', style: 'icon' })
    expect(JSON.parse(store.get(KEY)!)).toEqual({ enabled: true, when: 'always', style: 'icon' })
    m.setQuotaDisplay({ when: 'bogus' as never, enabled: false })
    expect(m.getQuotaDisplay()).toEqual({ enabled: false, when: 'always', style: 'icon' })
  })
  it('storage 事件：其它窗口改了之后同步过来', async () => {
    const m = await import('./quotaDisplay')
    const changed = vi.fn()
    const off = m.subscribeQuotaDisplay(changed)
    const handler = listeners.get('storage')!
    expect(handler).toBeTypeOf('function')
    store.set(KEY, JSON.stringify({ enabled: false, when: 'near-limit', style: 'full' }))
    handler({ storageArea: fakeStorage, key: KEY })
    expect(m.getQuotaDisplay()).toEqual({ enabled: false, when: 'near-limit', style: 'full' })
    expect(changed).toHaveBeenCalledTimes(1)
    // 别的键、别的存储区、值没变：不通知
    handler({ storageArea: fakeStorage, key: 'other' })
    handler({ storageArea: {}, key: KEY })
    handler({ storageArea: fakeStorage, key: KEY })
    expect(changed).toHaveBeenCalledTimes(1)
    // 清空存储（key 为 null）：回到默认
    store.clear()
    handler({ storageArea: fakeStorage, key: null })
    expect(m.getQuotaDisplay()).toEqual(m.DEFAULT_QUOTA_DISPLAY)
    expect(changed).toHaveBeenCalledTimes(2)
    off()
    expect(listeners.has('storage')).toBe(false)
  })
})
