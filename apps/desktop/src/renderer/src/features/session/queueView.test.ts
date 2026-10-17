import { describe, expect, it } from 'vitest'
import type { QueuedMessage } from '@pixelsky/protocol'
import { isReconnecting, isSendFailure, isStarting, reconnectPhase } from './queueView'

const item = (patch: Partial<QueuedMessage>): QueuedMessage => ({
  id: 'a',
  text: 'hi',
  createdAt: 1,
  settings: { model: null, effort: null, platform: null },
  status: 'queued',
  error: null,
  mode: 'normal',
  ...patch,
})

describe('空闲直接发送的显示规则', () => {
  it('直接发送在排队 / 启动中显示在对话里，不进队列面板', () => {
    expect(isStarting(item({ direct: true }), false)).toBe(true)
    expect(isStarting(item({ direct: true, status: 'dispatching' }), false)).toBe(true)
  })
  it('普通排队、暂停、单独暂停、已开始或失败的不算启动中', () => {
    expect(isStarting(item({}), false)).toBe(false)
    expect(isStarting(item({ direct: true }), true)).toBe(false)
    expect(isStarting(item({ direct: true, held: true }), false)).toBe(false)
    for (const status of ['running', 'failed', 'uncertain', 'delivering'] as const)
      expect(isStarting(item({ direct: true, status }), false)).toBe(false)
  })
  it('只有直接发送且执行失败的标为「发送失败」', () => {
    expect(isSendFailure(item({ direct: true, status: 'failed' }))).toBe(true)
    expect(isSendFailure(item({ status: 'failed' }))).toBe(false)
    expect(isSendFailure(item({ direct: true, status: 'uncertain' }))).toBe(false)
  })
})

describe('自动重连卡片的阶段', () => {
  const reconnect = { attempt: 1, max: 5, at: 10_000, since: 9_000, reason: '', resend: false }
  it('单独暂停（held）的重连项不显示重连卡片', () => {
    expect(isReconnecting(item({ reconnect }))).toBe(true)
    expect(isReconnecting(item({ reconnect, held: true }))).toBe(false)
    expect(isReconnecting(item({ reconnect, status: 'failed' }))).toBe(false)
  })
  it('倒计时 / 正在连接 / 已暂停 / 到点超过 3 秒还没动静', () => {
    const q = item({ reconnect })
    expect(reconnectPhase(q, false, 9_500)).toBe('waiting')
    expect(reconnectPhase(q, false, 10_000)).toBe('connecting')
    expect(reconnectPhase(q, false, 13_000)).toBe('connecting')
    expect(reconnectPhase(q, false, 13_001)).toBe('stalled')
    expect(reconnectPhase(item({ reconnect, status: 'dispatching' }), false, 20_000)).toBe('connecting')
    expect(reconnectPhase(q, true, 9_500)).toBe('paused')
    expect(reconnectPhase(q, true, 20_000)).toBe('paused')
  })
})
