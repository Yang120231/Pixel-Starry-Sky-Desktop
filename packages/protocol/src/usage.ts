// 用量与调用记录（docs/ui/usage.md §2、§6）：记录的类型 + 汇总 / 分页 / CSV 的纯函数。
// 引擎层（UsageStore）和界面（演示模式）共用，同一份规则。

export type UsageRoute = 'cli' | 'pixelsky' | 'api-key' | 'unknown'
export type UsageOutcome = 'completed' | 'interrupted' | 'failed'

/** 一条记录 = 一轮对话里一个模型的用量 */
export interface UsageRecord {
  costSource?: import('./billing').CostSource
  billing?: import('./billing').BillingSource
  v: 1
  /** 会话ID:轮次ID:模型，唯一 */
  id: string
  sessionId: string
  turnId: string
  startedAt: number
  endedAt: number
  /** 这一轮总耗时（毫秒） */
  durationMs: number
  /** 记录时的会话标题 */
  sessionTitle: string
  project: string | null
  engine: string
  model: string
  route: UsageRoute
  requests?: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  /** 引擎报告的费用（美元）；不报告时为 null */
  costUsd: number | null
  /**
   * 旧的云端记录没有请求 ID 对不上实扣，事后按时间对账号调用补录（docs/ui/usage.md §9.5）：
   * 'time' = 按时间对上，金额是实扣；'none' = 对过但没对上，不再重试
   */
  costMatch?: 'time' | 'none'
  outcome: UsageOutcome
}

export type UsageRangeId = 'today' | '7d' | '30d' | '90d'
export type UsageDimension = 'model' | 'project' | 'engine' | 'route'

/** 筛选条件：每个维度一个值，可以叠加 */
export type UsageFilter = Partial<Record<UsageDimension, string>>

export interface UsageTotals {
  /** Known charges supplied by the platform, without estimation. */
  costActual?: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  /** 有费用的记录的费用合计 */
  costUsd: number
  /** 有费用的记录条数（小于 records 时，费用合计是下限，显示「≥」） */
  costKnown: number
  records: number
  /** 轮次数（同一轮的多个模型算一轮） */
  turns: number
  requests: number
}

export interface UsageBucket extends UsageTotals {
  /** 这一格的开始时间（毫秒） */
  start: number
}

export interface UsageGroupRow extends UsageTotals {
  key: string
}

export interface UsageSummary {
  totals: UsageTotals
  /** 上一个同样长度的时间段，用于 ▲ / ▼ 比较 */
  prevTotals: UsageTotals
  /** 「今天」按小时，其余按天 */
  bucket: 'hour' | 'day'
  buckets: UsageBucket[]
  groups: Record<UsageDimension, UsageGroupRow[]>
}

export interface UsagePage {
  records: UsageRecord[]
  total: number
  offset: number
}

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

export interface TimeWindow {
  from: number
  to: number
  prevFrom: number
  bucket: 'hour' | 'day'
}

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 时间范围：「今天」从本地零点到现在；N 天包含今天 */
export function rangeWindow(range: UsageRangeId, now: number): TimeWindow {
  const today = startOfDay(now)
  if (range === 'today') return { from: today, to: now, prevFrom: today - DAY, bucket: 'hour' }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const from = startOfDay(today - (days - 1) * DAY + HOUR) // +1 小时：避开夏令时边界
  return { from, to: now, prevFrom: from - days * DAY, bucket: 'day' }
}

export function emptyTotals(): UsageTotals {
  return {
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    costUsd: 0,
    costKnown: 0,
    records: 0,
    turns: 0,
    requests: 0,
  }
}

function add(t: UsageTotals, r: UsageRecord, turns: Set<string>): void {
  t.input += r.input
  t.cacheRead += r.cacheRead
  t.cacheWrite += r.cacheWrite
  t.output += r.output
  t.requests += r.requests ?? 0
  t.records += 1
  if (r.costUsd !== null) {
    t.costUsd += r.costUsd
    t.costKnown += 1
    if (r.costSource === 'platform') t.costActual = (t.costActual ?? 0) + 1
  }
  const key = `${r.sessionId}:${r.turnId}`
  if (!turns.has(key)) {
    turns.add(key)
    t.turns += 1
  }
}

function matches(r: UsageRecord, filter: UsageFilter): boolean {
  for (const [dim, value] of Object.entries(filter) as Array<[UsageDimension, string | undefined]>) {
    if (value !== undefined && dimValue(r, dim) !== value) return false
  }
  return true
}

/** 记录在某个维度上的值；项目为空时归为「未归属项目」 */
export function dimValue(r: UsageRecord, dim: UsageDimension): string {
  if (dim === 'project') return r.project ?? ''
  return r[dim]
}

/** 总 token：输入 + 缓存读 + 缓存写 + 输出 */
export function totalTokens(t: Pick<UsageTotals, 'input' | 'cacheRead' | 'cacheWrite' | 'output'>): number {
  return t.input + t.cacheRead + t.cacheWrite + t.output
}

/** 缓存命中率 = 缓存读 / 全部输入；没有输入时为 null */
export function cacheHitRate(t: Pick<UsageTotals, 'input' | 'cacheRead' | 'cacheWrite'>): number | null {
  const all = t.input + t.cacheRead + t.cacheWrite
  return all > 0 ? t.cacheRead / all : null
}

export function summarize(records: UsageRecord[], range: UsageRangeId, filter: UsageFilter, now: number): UsageSummary {
  const w = rangeWindow(range, now)
  const totals = emptyTotals()
  const prevTotals = emptyTotals()
  const turns = new Set<string>()
  const prevTurns = new Set<string>()

  // 时间格：没有数据的格子也要有（柱状图补 0）
  const step = w.bucket === 'hour' ? HOUR : DAY
  const buckets: UsageBucket[] = []
  const bucketTurns: Array<Set<string>> = []
  for (let t = w.from; t <= w.to; t = w.bucket === 'hour' ? t + HOUR : startOfDay(t + DAY + HOUR)) {
    buckets.push({ ...emptyTotals(), start: t })
    bucketTurns.push(new Set())
  }

  const groupMaps: Record<UsageDimension, Map<string, { row: UsageGroupRow; turns: Set<string> }>> = {
    model: new Map(),
    project: new Map(),
    engine: new Map(),
    route: new Map(),
  }

  for (const r of records) {
    if (!matches(r, filter)) continue
    if (r.endedAt >= w.prevFrom && r.endedAt < w.from) add(prevTotals, r, prevTurns)
    if (r.endedAt < w.from || r.endedAt > w.to) continue
    add(totals, r, turns)
    // 找到所在的格子（按天时用本地日期，跨夏令时也正确）
    let i = Math.floor((r.endedAt - w.from) / step)
    if (w.bucket === 'day') {
      i = buckets.findIndex(
        (b, k) => r.endedAt >= b.start && (k === buckets.length - 1 || r.endedAt < buckets[k + 1].start),
      )
    }
    if (i >= 0 && i < buckets.length) add(buckets[i], r, bucketTurns[i])
    for (const dim of Object.keys(groupMaps) as UsageDimension[]) {
      const key = dimValue(r, dim)
      let g = groupMaps[dim].get(key)
      if (!g) {
        g = { row: { ...emptyTotals(), key }, turns: new Set() }
        groupMaps[dim].set(key, g)
      }
      add(g.row, r, g.turns)
    }
  }

  const sortRows = (m: Map<string, { row: UsageGroupRow }>) =>
    [...m.values()].map(g => g.row).sort((a, b) => totalTokens(b) - totalTokens(a))

  return {
    totals,
    prevTotals,
    bucket: w.bucket,
    buckets,
    groups: {
      model: sortRows(groupMaps.model),
      project: sortRows(groupMaps.project),
      engine: sortRows(groupMaps.engine),
      route: sortRows(groupMaps.route),
    },
  }
}

/** 明细：最新在前，分页 */
export function listRecords(
  records: UsageRecord[],
  range: UsageRangeId,
  filter: UsageFilter,
  now: number,
  offset: number,
  limit: number,
): UsagePage {
  const w = rangeWindow(range, now)
  const all = records
    .filter(r => r.endedAt >= w.from && r.endedAt <= w.to && matches(r, filter))
    .sort((a, b) => b.endedAt - a.endedAt)
  return { records: all.slice(offset, offset + limit), total: all.length, offset }
}

const OUTCOME_TEXT: Record<UsageRecord['outcome'], string> = {
  completed: '完成',
  interrupted: '已中断',
  failed: '失败',
}

/** CSV（UTF-8 带 BOM，Excel 直接打开不乱码） */
export function toCsv(records: UsageRecord[]): string {
  const head = [
    '时间',
    '会话',
    '项目',
    '引擎',
    '模型',
    '线路',
    '请求次数',
    '输入',
    '缓存读',
    '缓存写',
    '输出',
    '费用(USD)',
    '耗时(秒)',
    '结果',
  ]
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = (t: number) => {
    const d = new Date(t)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
  const rows = records.map(r =>
    [
      time(r.endedAt),
      r.sessionTitle,
      r.project ?? '',
      r.engine,
      r.model,
      r.route,
      r.requests ?? '',
      r.input,
      r.cacheRead,
      r.cacheWrite,
      r.output,
      r.costUsd === null ? '' : r.costUsd.toFixed(r.costSource === 'platform' ? 6 : 4),
      (r.durationMs / 1000).toFixed(1),
      OUTCOME_TEXT[r.outcome],
    ]
      .map(esc)
      .join(','),
  )
  return '﻿' + [head.join(','), ...rows].join('\r\n') + '\r\n'
}
