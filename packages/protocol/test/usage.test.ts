import { describe, expect, it } from 'vitest'
import {
  cacheHitRate,
  dimValue,
  emptyTotals,
  listRecords,
  rangeWindow,
  summarize,
  toCsv,
  totalTokens,
  type UsageRecord,
} from '../src/usage'

const HOUR = 3600_000
const DAY = 24 * HOUR
// 本地时间 2026-03-15 14:30，避免依赖运行机器的时区
const NOW = new Date(2026, 2, 15, 14, 30, 0).getTime()
const MIDNIGHT = new Date(2026, 2, 15, 0, 0, 0).getTime()

function rec(over: Partial<UsageRecord> = {}): UsageRecord {
  return {
    v: 1,
    id: 's1:t1:m',
    sessionId: 's1',
    turnId: 't1',
    startedAt: NOW - 60_000,
    endedAt: NOW - 1000,
    durationMs: 59_000,
    sessionTitle: '标题',
    project: 'p1',
    engine: 'claude',
    model: 'sonnet',
    route: 'cli',
    input: 10,
    cacheRead: 20,
    cacheWrite: 5,
    output: 7,
    costUsd: 0.5,
    outcome: 'completed',
    ...over,
  }
}

describe('rangeWindow', () => {
  it('今天：本地零点到现在，按小时，上一段为前一天零点', () => {
    expect(rangeWindow('today', NOW)).toEqual({ from: MIDNIGHT, to: NOW, prevFrom: MIDNIGHT - DAY, bucket: 'hour' })
  })
  it('7d / 30d / 90d 包含今天，按天，起点是本地零点', () => {
    for (const [id, days] of [['7d', 7], ['30d', 30], ['90d', 90]] as const) {
      const w = rangeWindow(id, NOW)
      expect(w.bucket).toBe('day')
      expect(w.to).toBe(NOW)
      expect(w.from).toBe(new Date(2026, 2, 15 - (days - 1), 0, 0, 0).getTime())
      expect(new Date(w.from).getHours()).toBe(0)
      expect(w.prevFrom).toBe(w.from - days * DAY)
    }
  })
  it('刚好零点时今天窗口起止相同', () => {
    const w = rangeWindow('today', MIDNIGHT)
    expect(w.from).toBe(MIDNIGHT)
    expect(w.to).toBe(MIDNIGHT)
  })
})

describe('totalTokens / cacheHitRate / dimValue', () => {
  it('总 token 为四项之和', () => {
    expect(totalTokens({ input: 1, cacheRead: 2, cacheWrite: 3, output: 4 })).toBe(10)
  })
  it('缓存命中率 = 缓存读 / (输入 + 缓存读 + 缓存写)', () => {
    expect(cacheHitRate({ input: 10, cacheRead: 20, cacheWrite: 10 })).toBe(0.5)
    expect(cacheHitRate({ input: 0, cacheRead: 5, cacheWrite: 0 })).toBe(1)
  })
  it('分母为 0 时返回 null', () => {
    expect(cacheHitRate({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull()
  })
  it('项目为空时维度值为空串，其余取字段', () => {
    expect(dimValue(rec({ project: null }), 'project')).toBe('')
    expect(dimValue(rec(), 'project')).toBe('p1')
    expect(dimValue(rec(), 'model')).toBe('sonnet')
    expect(dimValue(rec(), 'route')).toBe('cli')
  })
})

describe('summarize', () => {
  it('今天：按小时补零的格子，累计各项与轮次（同轮多模型算一轮）', () => {
    const rs = [
      rec({ id: 'a', model: 'sonnet' }),
      rec({ id: 'b', model: 'haiku', input: 1, cacheRead: 0, cacheWrite: 0, output: 1, costUsd: null }),
      rec({ id: 'c', turnId: 't2', endedAt: MIDNIGHT + 30 * 60_000, costUsd: 1 }),
    ]
    const s = summarize(rs, 'today', {}, NOW)
    expect(s.bucket).toBe('hour')
    // 零点到 14:30，共 15 个整点格
    expect(s.buckets).toHaveLength(15)
    expect(s.buckets[0].start).toBe(MIDNIGHT)
    expect(s.buckets[0].records).toBe(1)
    expect(s.buckets[14].records).toBe(2)
    expect(s.buckets[5].records).toBe(0)
    expect(s.totals.records).toBe(3)
    expect(s.totals.turns).toBe(2)
    expect(s.totals.input).toBe(21)
    expect(s.totals.costUsd).toBe(1.5)
    expect(s.totals.costKnown).toBe(2)
  })
  it('时间窗外的记录被排除；窗口之前同长度时间段进入 prevTotals', () => {
    const rs = [
      rec({ id: 'in' }),
      rec({ id: 'prev', endedAt: MIDNIGHT - HOUR }),
      rec({ id: 'old', endedAt: MIDNIGHT - 2 * DAY }),
      rec({ id: 'future', endedAt: NOW + HOUR }),
    ]
    const s = summarize(rs, 'today', {}, NOW)
    expect(s.totals.records).toBe(1)
    expect(s.prevTotals.records).toBe(1)
  })
  it('边界：endedAt 等于 from 与等于 to 都计入当前', () => {
    const s = summarize([rec({ id: 'a', endedAt: MIDNIGHT }), rec({ id: 'b', endedAt: NOW })], 'today', {}, NOW)
    expect(s.totals.records).toBe(2)
    expect(s.prevTotals.records).toBe(0)
  })
  it('筛选：多个维度叠加，值为 undefined 的维度不限制', () => {
    const rs = [
      rec({ id: 'a', model: 'sonnet', engine: 'claude' }),
      rec({ id: 'b', model: 'haiku', engine: 'claude' }),
      rec({ id: 'c', model: 'sonnet', engine: 'codex' }),
    ]
    expect(summarize(rs, 'today', { model: 'sonnet' }, NOW).totals.records).toBe(2)
    expect(summarize(rs, 'today', { model: 'sonnet', engine: 'codex' }, NOW).totals.records).toBe(1)
    expect(summarize(rs, 'today', { model: undefined }, NOW).totals.records).toBe(3)
  })
  it('筛选「未归属项目」用空串', () => {
    const rs = [rec({ id: 'a', project: null }), rec({ id: 'b' })]
    expect(summarize(rs, 'today', { project: '' }, NOW).totals.records).toBe(1)
  })
  it('分组：按总 token 降序，空项目归到空串键', () => {
    const rs = [
      rec({ id: 'a', model: 'small', input: 1, cacheRead: 0, cacheWrite: 0, output: 1, project: null }),
      rec({ id: 'b', model: 'big', input: 100, cacheRead: 0, cacheWrite: 0, output: 100 }),
      rec({ id: 'c', model: 'big', turnId: 't2', input: 1, cacheRead: 0, cacheWrite: 0, output: 1 }),
    ]
    const s = summarize(rs, 'today', {}, NOW)
    expect(s.groups.model.map((g) => g.key)).toEqual(['big', 'small'])
    expect(s.groups.model[0].records).toBe(2)
    expect(s.groups.model[0].turns).toBe(2)
    expect(s.groups.project.map((g) => g.key)).toEqual(['p1', ''])
    expect(s.groups.engine).toHaveLength(1)
    expect(s.groups.route[0].key).toBe('cli')
  })
  it('7d：按天分 7 格，记录落入所在日期的格子', () => {
    const s = summarize([rec({ id: 'a' }), rec({ id: 'b', endedAt: NOW - 3 * DAY })], '7d', {}, NOW)
    expect(s.bucket).toBe('day')
    expect(s.buckets).toHaveLength(7)
    expect(s.buckets[6].records).toBe(1)
    expect(s.buckets[3].records).toBe(1)
    expect(s.totals.records).toBe(2)
  })
  it('requests 缺省按 0 累加；costUsd 为 null 不计入 costKnown', () => {
    const s = summarize([rec({ id: 'a', requests: 3 }), rec({ id: 'b', costUsd: null })], 'today', {}, NOW)
    expect(s.totals.requests).toBe(3)
    expect(s.totals.costKnown).toBe(1)
  })
  it('costActual 是平台计费记录的条数（与 costKnown 同口径）', () => {
    const s = summarize(
      [rec({ id: 'a', costSource: 'platform', costUsd: 2 }), rec({ id: 'b', costSource: 'platform', costUsd: 3 })],
      'today',
      {},
      NOW,
    )
    expect(s.totals.costActual).toBe(2)
    expect(s.totals.costUsd).toBe(5)
  })
  it('没有记录时全部为 0', () => {
    const s = summarize([], 'today', {}, NOW)
    expect(s.totals).toEqual(emptyTotals())
    expect(s.totals.costActual).toBeUndefined()
  })
})

describe('listRecords', () => {
  const rs = [1, 2, 3, 4, 5].map((n) => rec({ id: `r${n}`, endedAt: NOW - n * 1000 }))
  it('最新在前，分页返回总数与偏移', () => {
    const p = listRecords(rs, 'today', {}, NOW, 0, 2)
    expect(p.records.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(p.total).toBe(5)
    expect(p.offset).toBe(0)
    expect(listRecords(rs, 'today', {}, NOW, 4, 2).records.map((r) => r.id)).toEqual(['r5'])
    expect(listRecords(rs, 'today', {}, NOW, 10, 2).records).toEqual([])
  })
  it('按范围和筛选过滤，且不改原数组顺序', () => {
    const mixed = [rec({ id: 'x', endedAt: MIDNIGHT - 1 }), rec({ id: 'y', model: 'haiku' }), rec({ id: 'z' })]
    const p = listRecords(mixed, 'today', { model: 'sonnet' }, NOW, 0, 10)
    expect(p.records.map((r) => r.id)).toEqual(['z'])
    expect(mixed.map((r) => r.id)).toEqual(['x', 'y', 'z'])
  })
})

describe('toCsv', () => {
  it('以 BOM 开头、CRLF 分行、结尾带换行；表头 14 列', () => {
    const csv = toCsv([])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.slice(1).split('\r\n')[0].split(',')).toHaveLength(14)
  })
  it('逗号、引号、换行被转义，引号翻倍', () => {
    const csv = toCsv([rec({ sessionTitle: 'a,b', project: 'say "hi"', model: 'x\ny' })])
    expect(csv).toContain('"a,b"')
    expect(csv).toContain('"say ""hi"""')
    expect(csv).toContain('"x\ny"')
  })
  it('字段格式：时间、空项目、请求次数缺省、费用位数、耗时、结果文字', () => {
    const csv = toCsv([
      rec({ endedAt: new Date(2026, 0, 2, 3, 4, 5).getTime(), project: null, costUsd: 0.123456, durationMs: 1500, outcome: 'failed' }),
      rec({ costUsd: null, costSource: 'platform', requests: 2, outcome: 'interrupted' }),
      rec({ costUsd: 0.5, costSource: 'platform', outcome: 'completed' }),
    ])
    const lines = csv.slice(1).split('\r\n')
    expect(lines[1]).toBe('2026-01-02 03:04:05,标题,,claude,sonnet,cli,,10,20,5,7,0.1235,1.5,失败')
    expect(lines[2].split(',')[6]).toBe('2')
    expect(lines[2].split(',')[11]).toBe('')
    expect(lines[2].endsWith('已中断')).toBe(true)
    expect(lines[3].split(',')[11]).toBe('0.500000')
    expect(lines[3].endsWith('完成')).toBe(true)
  })
})
