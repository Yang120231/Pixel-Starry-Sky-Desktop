import { describe, expect, it } from 'vitest'
import type { HostEvent } from '@pixelsky/protocol'
import {
  createDeliveryState,
  decide,
  DEFAULT_NOTIFICATION_PREFS,
  inSchedule,
  isQuiet,
  nextMorning,
  notificationFor,
  sanitizeNotificationPrefs,
  type NotificationIntent,
  type NotificationPrefs,
} from './policy'

const at = (h: number, m = 0) => new Date(2026, 9, 9, h, m)
const prefs = (patch: Partial<NotificationPrefs> = {}): NotificationPrefs => ({
  ...DEFAULT_NOTIFICATION_PREFS,
  ...patch,
  schedule: { ...DEFAULT_NOTIFICATION_PREFS.schedule, ...patch.schedule },
})
const intent = (kind: NotificationIntent['kind'], sessionId = 's1', key = kind + sessionId): NotificationIntent => ({
  kind,
  sessionId,
  dedupeKey: key,
  detail: null,
})
const session = (event: unknown): HostEvent => ({ kind: 'session', sessionId: 's1', seq: 1, event }) as HostEvent

describe('勿扰', () => {
  it('定时勿扰可以跨午夜，起止相同或关闭时不生效', () => {
    const night = { enabled: true, from: '22:00', to: '08:00' }
    expect(inSchedule(night, at(23))).toBe(true)
    expect(inSchedule(night, at(7, 59))).toBe(true)
    expect(inSchedule(night, at(8))).toBe(false)
    expect(inSchedule(night, at(12))).toBe(false)
    expect(inSchedule({ enabled: true, from: '13:00', to: '14:00' }, at(13, 30))).toBe(true)
    expect(inSchedule({ enabled: true, from: '09:00', to: '09:00' }, at(9))).toBe(false)
    expect(inSchedule({ ...night, enabled: false }, at(23))).toBe(false)
  })
  it('手动勿扰到期后自动结束', () => {
    const now = at(10)
    expect(isQuiet(prefs({ dndUntil: now.getTime() + 1000 }), now)).toBe(true)
    expect(isQuiet(prefs({ dndUntil: now.getTime() - 1 }), now)).toBe(false)
  })
  it('直到明早 8:00：凌晨就是当天 8 点，过了 8 点是第二天', () => {
    expect(nextMorning(at(2))).toBe(at(8).getTime())
    expect(nextMorning(at(9))).toBe(new Date(2026, 9, 10, 8).getTime())
    expect(nextMorning(at(8))).toBe(new Date(2026, 9, 10, 8).getTime())
  })
})

describe('偏好校验', () => {
  it('损坏或旧版数据逐项回退到默认值', () => {
    expect(sanitizeNotificationPrefs('坏数据')).toEqual(DEFAULT_NOTIFICATION_PREFS)
    expect(
      sanitizeNotificationPrefs({
        completed: false,
        sound: 'yes',
        dndUntil: Infinity,
        schedule: { enabled: true, from: '25:00', to: '07:30' },
      }),
    ).toEqual({
      ...DEFAULT_NOTIFICATION_PREFS,
      completed: false,
      schedule: { enabled: true, from: '22:00', to: '07:30' },
    })
  })
})

describe('引擎事件 → 提醒', () => {
  it('完成、失败提醒，用户打断不提醒；审批按请求 id 去重', () => {
    expect(
      notificationFor(session({ type: 'turn_completed', turnId: 't', outcome: 'completed', error: null })),
    ).toMatchObject({ kind: 'completed', dedupeKey: 'c:s1:t' })
    expect(
      notificationFor(session({ type: 'turn_completed', turnId: 't', outcome: 'failed', error: '额度不足' })),
    ).toMatchObject({ kind: 'failed', detail: '额度不足' })
    expect(
      notificationFor(session({ type: 'turn_completed', turnId: 't', outcome: 'interrupted', error: null })),
    ).toBeNull()
    expect(
      notificationFor(
        session({
          type: 'approval_request',
          request: {
            requestId: 'r1',
            itemId: null,
            kind: 'command',
            title: '运行命令',
            command: 'npm test',
            alwaysScopes: [],
          },
        }),
      ),
    ).toMatchObject({ kind: 'waiting', dedupeKey: 'w:s1:r1', detail: 'npm test' })
    expect(notificationFor(session({ type: 'status', state: 'idle' }))).toBeNull()
    expect(notificationFor({ kind: 'usage_recorded' })).toBeNull()
  })
})

describe('是否弹出', () => {
  const base = { prefs: prefs(), focused: false, viewing: false, now: at(10).getTime() }
  it('开关、勿扰、前台规则', () => {
    expect(decide(intent('completed'), { ...base, prefs: prefs({ completed: false }) }, createDeliveryState())).toEqual(
      { show: false, reason: 'disabled' },
    )
    expect(
      decide(intent('completed'), { ...base, prefs: prefs({ dndUntil: base.now + 1 }) }, createDeliveryState()),
    ).toEqual({ show: false, reason: 'quiet' })
    expect(decide(intent('completed'), { ...base, focused: true }, createDeliveryState())).toEqual({
      show: false,
      reason: 'focused',
    })
    // 关闭「仅后台」：前台时只要没在看这个会话就提醒
    const any = prefs({ unfocusedOnly: false })
    expect(
      decide(intent('completed'), { ...base, prefs: any, focused: true, viewing: true }, createDeliveryState()),
    ).toEqual({ show: false, reason: 'viewing' })
    expect(decide(intent('completed'), { ...base, prefs: any, focused: true }, createDeliveryState())).toEqual({
      show: true,
      summary: false,
    })
    expect(decide(intent('completed'), base, createDeliveryState())).toEqual({ show: true, summary: false })
  })
  it('同一个提醒只发一次；勿扰期间跳过的不补发', () => {
    const state = createDeliveryState()
    expect(decide(intent('waiting'), { ...base, prefs: prefs({ dndUntil: base.now + 1 }) }, state).show).toBe(false)
    expect(decide(intent('waiting'), { ...base, now: base.now + 10_000 }, state)).toEqual({
      show: false,
      reason: 'duplicate',
    })
  })
  it('同一会话 3 秒内只弹一次；10 秒内超过 4 条合并成一条摘要，之后静默', () => {
    const state = createDeliveryState()
    expect(decide(intent('completed', 's1', 'a'), base, state).show).toBe(true)
    expect(decide(intent('failed', 's1', 'b'), { ...base, now: base.now + 1000 }, state)).toEqual({
      show: false,
      reason: 'throttled',
    })
    const results = ['s2', 's3', 's4', 's5', 's6'].map((id, i) =>
      decide(intent('completed', id), { ...base, now: base.now + 100 * (i + 1) }, state),
    )
    expect(results.map(r => (r.show ? (r.summary ? 'summary' : 'show') : r.reason))).toEqual([
      'show',
      'show',
      'show',
      'summary',
      'throttled',
    ])
    expect(decide(intent('completed', 's7'), { ...base, now: base.now + 20_000 }, state)).toEqual({
      show: true,
      summary: false,
    })
  })
})
