import { describe, expect, it, vi } from 'vitest'
import { getExtDetail, getExtTab, openExtDetail, openExtTab, trackExtPage } from './nav'

describe('扩展页签 nav', () => {
  it('默认「已安装」；openExtTab 换了页签，值变了，订阅者收到通知', () => {
    expect(getExtTab()).toBe('installed')
    openExtTab('discover')
    expect(getExtTab()).toBe('discover')
    openExtTab('publish')
    expect(getExtTab()).toBe('publish')
    openExtTab('installed')
  })

  it('点进详情会停在「发现」；换页签时收起详情', () => {
    openExtDetail('pixelsky.swift')
    expect(getExtTab()).toBe('discover')
    expect(getExtDetail()).toBe('pixelsky.swift')
    openExtTab('installed')
    expect(getExtDetail()).toBeNull()
    openExtDetail('a.b')
    openExtDetail(null)
    expect(getExtDetail()).toBeNull()
    expect(getExtTab()).toBe('discover')
    openExtTab('installed')
  })

  it('页面卸载后页签放回「已安装」；StrictMode 式的立刻重挂不重置', async () => {
    vi.useFakeTimers()
    try {
      openExtTab('discover')
      const off = trackExtPage()
      off()
      const off2 = trackExtPage()
      await vi.runAllTimersAsync()
      expect(getExtTab()).toBe('discover')
      off2()
      await vi.runAllTimersAsync()
      expect(getExtTab()).toBe('installed')
    } finally {
      vi.useRealTimers()
    }
  })
})
