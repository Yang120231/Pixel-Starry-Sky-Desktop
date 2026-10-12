import { describe, expect, it } from 'vitest'
import type { QueuedMessage, SessionSnapshot } from '@pixelsky/protocol'
import { canSteer, isPending, queueItems, queueLabel, queueTitle } from './queue'

const q = (id: string, patch: Partial<QueuedMessage> = {}): QueuedMessage => ({
  id,
  text: id,
  createdAt: 0,
  settings: {} as QueuedMessage['settings'],
  status: 'queued',
  error: null,
  mode: 'normal',
  ...patch,
})

describe('消息队列面板', () => {
  it('不显示正在执行的，也不显示空闲时直接发送、正在启动的（那些在对话里）', () => {
    const queue = [
      q('run', { status: 'running' }),
      q('direct', { direct: true }),
      q('wait'),
      q('fail', { direct: true, status: 'failed' }),
    ]
    expect(queueItems({ queue, queuePaused: false }).map(i => i.id)).toEqual(['wait', 'fail'])
    // 队列暂停时，直接发送的也留在队列里等「继续队列」
    expect(queueItems({ queue, queuePaused: true }).map(i => i.id)).toEqual(['direct', 'wait', 'fail'])
  })

  it('每条的状态和面板标题', () => {
    expect(queueLabel(q('a'))).toBe('排队中')
    expect(queueLabel(q('a', { held: true }))).toBe('已暂停')
    expect(queueLabel(q('a', { direct: true, status: 'failed' }))).toBe('发送失败')
    expect(queueLabel(q('a', { status: 'failed' }))).toBe('执行失败')
    expect(queueLabel(q('a', { status: 'uncertain' }))).toBe('待核对')
    expect(queueTitle([q('a', { direct: true, status: 'failed' })], false)).toBe('发送失败')
    expect(queueTitle([q('a')], true)).toBe('队列已暂停')
    expect(queueTitle([q('a', { held: true })], false)).toBe('队列已暂停')
    expect(queueTitle([q('a')], false)).toBe('排队中')
    expect(isPending(q('a', { status: 'delivering' }))).toBe(true)
  })

  it('引导：要排队中、引擎支持、正在跑一轮', () => {
    const running = { state: 'running', turnId: 't1', flags: { steerAvailable: true } } as SessionSnapshot
    expect(canSteer(q('a'), running)).toBe(true)
    expect(canSteer(q('a', { status: 'failed' }), running)).toBe(false)
    expect(canSteer(q('a'), { ...running, flags: { ...running.flags, steerAvailable: false } })).toBe(false)
    expect(canSteer(q('a'), { ...running, state: 'idle', turnId: null })).toBe(false)
  })
})
