// 账号调用的合计换成本机记录同样的 UsageSummary（docs/ui/usage.md §9.4），卡片、图表、分布表直接复用。
// 账号调用没有「轮次」：每次请求算一条记录、一轮；金额都是实扣，所以 costKnown = costActual = 请求数。
import type { RemoteCall, RemoteUsageStat, RemoteUsageSummary } from '@pixelsky/protocol'
import { emptyTotals, rangeWindow, summarize, totalTokens } from './aggregate'
import type { UsageGroupRow, UsageRangeId, UsageSummary, UsageTotals } from './types'

export function statTotals(s: RemoteUsageStat): UsageTotals {
  return {
    input: s.input,
    cacheRead: s.cacheRead,
    cacheWrite: s.cacheWrite,
    output: s.output,
    costUsd: s.costUsd,
    costKnown: s.requests,
    costActual: s.requests,
    records: s.requests,
    turns: s.requests,
    requests: s.requests,
  }
}

function addTotals(t: UsageTotals, s: UsageTotals): void {
  t.input += s.input
  t.cacheRead += s.cacheRead
  t.cacheWrite += s.cacheWrite
  t.output += s.output
  t.costUsd += s.costUsd
  t.costKnown += s.costKnown
  t.costActual = (t.costActual ?? 0) + (s.costActual ?? 0)
  t.records += s.records
  t.turns += s.turns
  t.requests += s.requests
}

export function toUsageSummary(remote: RemoteUsageSummary, range: UsageRangeId, now: number): UsageSummary {
  // 格子和本机记录一样（没有调用的格子补 0）
  const grid = summarize([], range, {}, now)
  const buckets = grid.buckets.map(b => ({ ...b, costActual: 0 }))
  for (const r of remote.buckets) {
    // 云端按服务器时区分天；落在本机第一格之前的（时区差几小时）算进第一格
    let i = buckets.length - 1
    while (i > 0 && buckets[i].start > r.start) i--
    if (buckets.length > 0) addTotals(buckets[i], statTotals(r))
  }
  const models: UsageGroupRow[] = remote.models
    .map(m => ({ ...statTotals(m), key: m.model }))
    .sort((a, b) => totalTokens(b) - totalTokens(a))
  return {
    totals: statTotals(remote.total),
    prevTotals: statTotals(remote.prevTotal),
    bucket: grid.bucket,
    buckets,
    groups: { model: models, project: [], engine: [], route: [], cost: [] },
  }
}

function emptyStat(): RemoteUsageStat {
  const { requests, input, output, cacheRead, cacheWrite, costUsd } = emptyTotals()
  return { requests, input, output, cacheRead, cacheWrite, costUsd }
}

function addCall(s: RemoteUsageStat, c: RemoteCall): void {
  s.requests += 1
  s.input += c.input
  s.output += c.output
  s.cacheRead += c.cacheRead
  s.cacheWrite += c.cacheWrite
  s.costUsd += c.costUsd ?? 0
}

/** 演示模式：把假调用记录按云端接口的样子合计 */
export function summarizeCalls(
  calls: RemoteCall[],
  range: UsageRangeId,
  model: string | null,
  now: number,
): RemoteUsageSummary {
  const w = rangeWindow(range, now)
  const starts = summarize([], range, {}, now).buckets.map(b => b.start)
  const total = emptyStat()
  const prevTotal = emptyStat()
  const buckets = new Map<number, RemoteUsageStat & { start: number }>()
  const models = new Map<string, RemoteUsageStat & { model: string }>()
  for (const c of calls) {
    if (model !== null && c.model !== model) continue
    if (c.createdAt >= w.prevFrom && c.createdAt < w.from) addCall(prevTotal, c)
    if (c.createdAt < w.from || c.createdAt > now) continue
    addCall(total, c)
    const start = starts.findLast(s => s <= c.createdAt) ?? w.from
    let b = buckets.get(start)
    if (!b) buckets.set(start, (b = { ...emptyStat(), start }))
    addCall(b, c)
    let m = models.get(c.model)
    if (!m) models.set(c.model, (m = { ...emptyStat(), model: c.model }))
    addCall(m, c)
  }
  return {
    buckets: [...buckets.values()].sort((a, b) => a.start - b.start),
    models: [...models.values()],
    total,
    prevTotal,
  }
}
