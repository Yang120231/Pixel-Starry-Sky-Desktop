// 往界面发消息的守卫（docs/ui/renderer-memory.md §3.1.2）
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

const lines = vi.hoisted(() => [] as { level: string; message: string; fields?: Record<string, unknown> }[])
vi.mock('@pixelsky/engine', () => ({
  logger: () => {
    const write = (level: string) => (message: string, fields?: Record<string, unknown>) =>
      lines.push({ level, message, fields })
    return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') }
  },
}))

import {
  canSend,
  isRecovering,
  markReady,
  markRecovering,
  READY_TIMEOUT_MS,
  sendTo,
  sendWhenReady,
} from './rendererHealth'

class FakeContents extends EventEmitter {
  destroyed = false
  crashed = false
  loading = false
  sent: unknown[][] = []
  isDestroyed = () => this.destroyed
  isCrashed = () => this.crashed
  isLoading = () => this.loading
  send = (...args: unknown[]) => void this.sent.push(args)
  asContents = () => this as unknown as WebContents
}

describe('rendererHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    lines.length = 0
  })
  afterEach(() => vi.useRealTimers())

  it('正常、销毁、崩溃时的 canSend', () => {
    const wc = new FakeContents()
    expect(canSend(wc.asContents())).toBe(true)
    wc.crashed = true
    expect(canSend(wc.asContents())).toBe(false)
    wc.crashed = false
    wc.destroyed = true
    expect(canSend(wc.asContents())).toBe(false)
  })

  it('恢复中丢弃并按通道计数，报到后才恢复，并记汇总', () => {
    const wc = new FakeContents()
    const c = wc.asContents()
    markRecovering(c)
    expect(canSend(c)).toBe(false)
    expect(sendTo(c, 'engine:event', 1)).toBe(false)
    expect(sendTo(c, 'engine:event', 2)).toBe(false)
    expect(sendTo(c, 'window:state', {})).toBe(false)
    // did-finish-load 不清标记
    wc.emit('did-finish-load')
    expect(canSend(c)).toBe(false)
    vi.advanceTimersByTime(500)
    markReady(c)
    expect(canSend(c)).toBe(true)
    expect(sendTo(c, 'engine:event', 3)).toBe(true)
    expect(wc.sent).toEqual([['engine:event', 3]])
    expect(lines).toEqual([
      {
        level: 'info',
        message: '恢复期间丢弃的消息',
        fields: { ms: 500, total: 3, channels: { 'engine:event': 2, 'window:state': 1 } },
      },
    ])
    // 计数已清空：再恢复一次从零算
    markRecovering(c)
    markReady(c)
    expect(lines[1].fields).toMatchObject({ total: 0, channels: {} })
  })

  it('不在恢复中时 markReady 什么都不做', () => {
    const wc = new FakeContents()
    markReady(wc.asContents())
    expect(lines).toEqual([])
  })

  it('加载完 10 秒没报到：清标记并记 warn', () => {
    const wc = new FakeContents()
    const c = wc.asContents()
    markRecovering(c)
    wc.emit('did-finish-load')
    vi.advanceTimersByTime(READY_TIMEOUT_MS - 1)
    expect(canSend(c)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(canSend(c)).toBe(true)
    expect(lines.map(l => [l.level, l.message])).toEqual([
      ['warn', '界面加载完但没有报到'],
      ['info', '恢复期间丢弃的消息'],
    ])
  })

  it('报到后保险计时作废', () => {
    const wc = new FakeContents()
    const c = wc.asContents()
    markRecovering(c)
    wc.emit('did-finish-load')
    markReady(c)
    lines.length = 0
    vi.advanceTimersByTime(READY_TIMEOUT_MS * 2)
    expect(lines).toEqual([])
  })

  it('加载中又崩：保险计时作废，仍然在恢复中', () => {
    const wc = new FakeContents()
    const c = wc.asContents()
    markRecovering(c)
    wc.emit('did-finish-load')
    vi.advanceTimersByTime(5_000)
    markRecovering(c)
    vi.advanceTimersByTime(READY_TIMEOUT_MS * 2)
    expect(isRecovering(c)).toBe(true)
  })

  it('sendWhenReady：恢复中等报到，只留最后一条', () => {
    const wc = new FakeContents()
    const c = wc.asContents()
    markRecovering(c)
    sendWhenReady(c, 'tray:command', 'a')
    sendWhenReady(c, 'tray:command', 'b')
    expect(wc.sent).toEqual([])
    markReady(c)
    expect(wc.sent).toEqual([['tray:command', 'b']])
  })

  it('sendWhenReady：不同通道各留最后一条，按先后发出', () => {
    const wc = new FakeContents()
    const c = wc.asContents()
    markRecovering(c)
    sendWhenReady(c, 'notify:clicked', 1)
    sendWhenReady(c, 'tray:command', 'a')
    sendWhenReady(c, 'notify:clicked', 2)
    markReady(c)
    expect(wc.sent).toEqual([
      ['notify:clicked', 2],
      ['tray:command', 'a'],
    ])
  })

  it('sendWhenReady：加载中等 did-finish-load，空闲时直接发', () => {
    const wc = new FakeContents()
    const c = wc.asContents()
    wc.loading = true
    sendWhenReady(c, 'notify:clicked', 1)
    expect(wc.sent).toEqual([])
    wc.loading = false
    wc.emit('did-finish-load')
    expect(wc.sent).toEqual([['notify:clicked', 1]])
    sendWhenReady(c, 'notify:clicked', 2)
    expect(wc.sent).toHaveLength(2)
  })

  it('sendWhenReady：窗口关闭时丢掉', () => {
    const wc = new FakeContents()
    const c = wc.asContents()
    markRecovering(c)
    sendWhenReady(c, 'tray:command', 'a')
    wc.destroyed = true
    wc.emit('destroyed')
    markReady(c)
    expect(wc.sent).toEqual([])
  })
})
