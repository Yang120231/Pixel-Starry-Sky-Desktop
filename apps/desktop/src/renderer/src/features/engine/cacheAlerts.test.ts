import { describe, expect, it } from 'vitest'
import type { CacheWarning, HostEvent } from '@pixelsky/protocol'
import { applyCacheAlertEvent, emptyCacheAlerts, expireCacheAlerts } from './cacheAlerts'

const warning = (sessionId = 's', turnId = 't', expiresAt = 6000): HostEvent => ({
  kind: 'cache_warning',
  warning: {
    sessionId,
    turnId,
    expiresAt,
    messageId: 'm',
    model: 'opus',
    title: 'test',
    input: 12000,
    cached: 0,
    previousInput: 10000,
  },
})
describe('缓存提醒生命周期', () => {
  it('重复提醒不延长计时，原始时间过期后不会重放', () => {
    const original = applyCacheAlertEvent(emptyCacheAlerts(), warning(), 1000, true)
    const repeated = applyCacheAlertEvent(original, warning('s', 't', 9000), 2000, true)
    expect(repeated.cards[0].warning.expiresAt).toBe(6000)
    const expired = expireCacheAlerts(repeated, 6000)
    expect(expired.cards).toHaveLength(0)
    expect(applyCacheAlertEvent(expired, warning('s', 't', 9000), 6100, true).cards).toHaveLength(0)
    expect(applyCacheAlertEvent(emptyCacheAlerts(), warning(), 6001, true).cards).toHaveLength(0)
  })
  it('当前轮结束/下一轮开始清除旧提醒，过期轮次不能回来', () => {
    let state = applyCacheAlertEvent(
      emptyCacheAlerts(),
      { kind: 'session', sessionId: 's', seq: 1, event: { type: 'turn_started', turnId: 't' } },
      1000,
      true,
    )
    state = applyCacheAlertEvent(state, warning(), 1100, true)
    state = applyCacheAlertEvent(
      state,
      {
        kind: 'session',
        sessionId: 's',
        seq: 2,
        event: { type: 'turn_completed', turnId: 't', outcome: 'completed', error: null },
      },
      1200,
      true,
    )
    expect(state.cards).toHaveLength(0)
    state = applyCacheAlertEvent(
      state,
      { kind: 'session', sessionId: 's', seq: 3, event: { type: 'turn_started', turnId: 'next' } },
      1300,
      true,
    )
    expect(applyCacheAlertEvent(state, warning(), 1400, true).cards).toHaveLength(0)
    expect(applyCacheAlertEvent(state, warning('s', 'next'), 1400, true).cards).toHaveLength(1)
  })
  it('关闭时不显示或迟到重放，一次最多三张，会话删除清除卡片', () => {
    let state = applyCacheAlertEvent(emptyCacheAlerts(), warning(), 1000, false)
    expect(applyCacheAlertEvent(state, warning(), 1100, true).cards).toHaveLength(0)
    for (const id of ['one', 'two', 'three', 'four']) state = applyCacheAlertEvent(state, warning(id), 1200, true)
    expect(state.cards.map(c => c.warning.sessionId)).toEqual(['two', 'three', 'four'])
    state = applyCacheAlertEvent(state, { kind: 'sessions', sessions: [] }, 1300, true)
    expect(state.cards).toHaveLength(0)
  })
  it('停止操作执行中保留状态，失败说明按独立时间收起', () => {
    const w = (warning() as { warning: CacheWarning }).warning
    const state = { ...emptyCacheAlerts(), cards: [{ warning: w, stopping: true }] }
    expect(expireCacheAlerts(state, 9000).cards).toHaveLength(1)
    const failed = { ...state, cards: [{ warning: w, stopping: false, error: 'network', errorExpiresAt: 10000 }] }
    expect(expireCacheAlerts(failed, 9000).cards).toHaveLength(1)
    expect(expireCacheAlerts(failed, 10000).cards).toHaveLength(0)
  })
})
