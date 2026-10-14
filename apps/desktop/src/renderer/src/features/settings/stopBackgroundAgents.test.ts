import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
})

describe('停止时一起停后台子智能体的开关', () => {
  it('默认开', async () => {
    const m = await import('./stopBackgroundAgents')
    expect(m.getStopBackgroundAgents()).toBe(true)
  })
  it("存了 'false' 就是关", async () => {
    store.set('pixelsky.stop-background-subagents', 'false')
    const m = await import('./stopBackgroundAgents')
    expect(m.getStopBackgroundAgents()).toBe(false)
  })
  it('set 写入 String(v) 并立刻生效', async () => {
    const m = await import('./stopBackgroundAgents')
    m.setStopBackgroundAgents(false)
    expect(store.get('pixelsky.stop-background-subagents')).toBe('false')
    expect(m.getStopBackgroundAgents()).toBe(false)
  })
})
