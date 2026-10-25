import { describe, expect, it } from 'vitest'
import { DAY_MS, idleLabel, isRunningError, parseDays, planArchive, skipReason, type ArchiveItem } from './archiveOld'

const now = 1_000 * DAY_MS
const item = (id: string, idle: number, extra: Partial<ArchiveItem> = {}): ArchiveItem => ({
  id,
  title: id,
  projectId: 'p1',
  projectName: 'p1',
  lastActive: now - idle * DAY_MS,
  pinned: false,
  running: false,
  open: false,
  channel: false,
  ...extra,
})

describe('planArchive', () => {
  it('只取超过天数的，最久的在前；刚好 14 天不算', () => {
    const plan = planArchive([item('a', 20), item('b', 14), item('c', 60), item('d', 3)], {
      days: 14,
      projectId: null,
      now,
    })
    expect(plan.pick.map(i => i.id)).toEqual(['c', 'a'])
    expect(plan.skip).toEqual([])
  })

  it('置顶 / 运行中 / 开着 / 频道绑定的进不会归档分组，并写原因', () => {
    const plan = planArchive(
      [
        item('pin', 30, { pinned: true }),
        item('run', 30, { running: true }),
        item('open', 30, { open: true }),
        item('chan', 30, { channel: true }),
        item('ok', 30),
        item('new', 1, { pinned: true }),
      ],
      { days: 14, projectId: null, now },
    )
    expect(plan.pick.map(i => i.id)).toEqual(['ok'])
    expect(plan.skip.map(s => [s.item.id, s.reason])).toEqual([
      ['pin', 'pinned'],
      ['run', 'running'],
      ['open', 'open'],
      ['chan', 'channel'],
    ])
  })

  it('范围限定到一个项目', () => {
    const plan = planArchive([item('a', 30), item('b', 30, { projectId: 'p2' })], {
      days: 14,
      projectId: 'p2',
      now,
    })
    expect(plan.pick.map(i => i.id)).toEqual(['b'])
  })

  it('原因优先级：置顶 > 运行中 > 开着 > 频道', () => {
    expect(skipReason(item('x', 1, { pinned: true, running: true, open: true, channel: true }))).toBe('pinned')
    expect(skipReason(item('x', 1, { running: true, open: true }))).toBe('running')
    expect(skipReason(item('x', 1, { open: true, channel: true }))).toBe('open')
    expect(skipReason(item('x', 1))).toBeNull()
  })
})

describe('parseDays', () => {
  it('只收 1 到 3650 的整数', () => {
    expect(parseDays('45')).toBe(45)
    expect(parseDays(' 7 ')).toBe(7)
    for (const bad of ['', '0', '-3', '1.5', 'abc', '3651', '99999']) expect(parseDays(bad)).toBeNull()
  })
})

describe('idleLabel', () => {
  it('天 / 周 / 月', () => {
    expect(idleLabel(now - 15 * DAY_MS, now)).toEqual({ key: 'archiveOld.ago.w', n: 2 })
    expect(idleLabel(now - 9 * DAY_MS, now)).toEqual({ key: 'archiveOld.ago.d', n: 9 })
    expect(idleLabel(now - 21 * DAY_MS, now)).toEqual({ key: 'archiveOld.ago.w', n: 3 })
    expect(idleLabel(now - 60 * DAY_MS, now)).toEqual({ key: 'archiveOld.ago.m', n: 2 })
  })
})

describe('isRunningError', () => {
  it('认出主进程的 SESSION_RUNNING，其它错误不算', () => {
    expect(isRunningError('Error invoking remote method: Error: SESSION_RUNNING')).toBe(true)
    expect(isRunningError('SESSION_NOT_FOUND')).toBe(false)
  })
})
