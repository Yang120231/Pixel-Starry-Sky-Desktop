import { beforeEach, describe, expect, it, vi } from 'vitest'

// 页面状态是模块级单例，每个用例重新加载
beforeEach(() => { vi.resetModules() })

describe('主区页面状态', () => {
  it('默认是工作台；切换时只通知一次，相同的值不通知', async () => {
    const { getPage, setPage, subscribePage } = await import('./page')
    expect(getPage()).toBe('workbench')
    const listener = vi.fn()
    subscribePage(listener)
    setPage('channels')
    setPage('channels')
    expect(getPage()).toBe('channels')
    expect(listener).toHaveBeenCalledTimes(1)
  })
  it('showWorkbench 从频道页切回，退订后不再通知', async () => {
    const { getPage, setPage, showWorkbench, subscribePage } = await import('./page')
    setPage('channels')
    const listener = vi.fn()
    const unsubscribe = subscribePage(listener)
    showWorkbench()
    expect(getPage()).toBe('workbench')
    unsubscribe()
    setPage('channels')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
