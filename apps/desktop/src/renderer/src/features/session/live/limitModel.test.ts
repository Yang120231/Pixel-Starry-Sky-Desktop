import { beforeAll, describe, expect, it } from 'vitest'
import type { QueuedMessage } from '@pixelsky/protocol'
import { setCurrentLocale } from '@/i18n/core'
import { isLimitWait, isReconnecting } from '../queueView'
import { countdownText, limitItem, limitPhase, limitProgress, limitTries, sidebarRemaining } from './limitModel'

beforeAll(() => setCurrentLocale('zh-CN'))

const wait = (extra: Partial<QueuedMessage> = {}, tries: number[] = []): QueuedMessage => ({
  id: 'q',
  text: 'a',
  createdAt: 0,
  settings: { model: null, effort: null, platform: null },
  status: 'queued',
  error: null,
  mode: 'normal',
  limit: { kind: 'quota', window: 'five_hour', resetsAt: null, tries },
  reconnect: { attempt: tries.length + 1, max: 3, since: 1_000, at: 11_000, reason: '', limited: true },
  ...extra,
})

describe('倒计时和侧栏剩余时间', () => {
  it('卡片倒计时：不足 1 小时 m:ss，否则 h:mm:ss；已到点 0:00', () => {
    expect(countdownText(0)).toBe('0:00')
    expect(countdownText(-5)).toBe('0:00')
    expect(countdownText(65_000)).toBe('1:05')
    expect(countdownText(83 * 60_000 + 45_000)).toBe('1:23:45')
    expect(countdownText(500)).toBe('0:01')
  })

  it('侧栏：超过 1 小时写 1:23，不足写「12 分」，向上取整、至少 1 分', () => {
    expect(sidebarRemaining(83 * 60_000)).toBe('1:23')
    expect(sidebarRemaining(60 * 60_000)).toBe('1:00')
    expect(sidebarRemaining(12 * 60_000 - 1)).toBe('12 分')
    expect(sidebarRemaining(59 * 60_000 + 1)).toBe('1:00')
    expect(sidebarRemaining(10)).toBe('1 分')
  })
})

describe('限流卡片的阶段', () => {
  it('倒计时中 / 到点正在继续 / 到点却没动静回到倒计时', () => {
    const q = wait()
    expect(limitPhase(q, false, 5_000)).toBe('waiting')
    expect(limitPhase(q, false, 11_500)).toBe('connecting')
    expect(limitPhase(wait({ status: 'dispatching' }), false, 5_000)).toBe('connecting')
    expect(limitPhase(q, false, 20_000)).toBe('waiting')
  })

  it('队列暂停（取消勾选、重启后恢复）是 paused；次数用完是 stopped，优先于 paused', () => {
    expect(limitPhase(wait(), true, 5_000)).toBe('paused')
    const used = wait({}, [1, 2, 3])
    expect(limitTries(used)).toBe(3)
    expect(limitPhase(used, true, 5_000)).toBe('stopped')
    expect(limitPhase(used, false, 5_000)).toBe('stopped')
  })

  it('进度条按开始等到到点算，夹在 0–100', () => {
    expect(limitProgress(wait(), 6_000)).toBe(50)
    expect(limitProgress(wait(), 0)).toBe(0)
    expect(limitProgress(wait(), 99_000)).toBe(100)
  })
})

describe('队列项分类', () => {
  it('限流等待不算断线重连（各有各的卡片），也不进消息队列', () => {
    const q = wait()
    expect(isLimitWait(q)).toBe(true)
    expect(isReconnecting(q)).toBe(false)
    const plain = wait({ reconnect: { attempt: 1, max: 5, since: 0, at: 0, reason: '' }, limit: undefined })
    expect(isLimitWait(plain)).toBe(false)
    expect(isReconnecting(plain)).toBe(true)
    expect(limitItem([plain, q])).toBe(q)
    expect(limitItem([plain])).toBeUndefined()
  })

  it('单独暂停（held）的和已失败的不算在等', () => {
    expect(isLimitWait(wait({ held: true }))).toBe(false)
    expect(isLimitWait(wait({ status: 'failed' }))).toBe(false)
  })
})
