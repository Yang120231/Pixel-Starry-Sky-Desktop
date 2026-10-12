// 旧云端记录补录实扣（docs/ui/usage.md §11.2）：桌面端 0.2.8 以前没拿到 Sub2api 的请求 ID，
// 这些轮次按 ID 永远查不到实扣，只能按时间把账号调用对回到轮次上。纯函数，HostUsage 负责读写。
import type { BillingSource, RemoteCall, UsageRecord } from '@pixelsky/protocol'

export interface BackfillTurn {
  /** 会话ID:轮次ID */
  key: string
  startedAt: number
  endedAt: number
  rows: UsageRecord[]
}

/** 一轮里一个模型对上的调用合计 */
export interface BackfillCharge {
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costUsd: number
  billing?: BillingSource
}

/** 调用的开始时间可以比本机记的这一轮早 / 晚这么多（本机的开始时间是结束时间减耗时，不精确） */
const SLACK_MS = 20_000
/** token 完全一样的调用，离本机结束时间最多这么远才算同一次（用来量时钟差） */
const FINGERPRINT_MS = 10 * 60_000
/** 太小的用量容易撞上，不拿来量时钟差 */
const FINGERPRINT_MIN_TOKENS = 100

const tokens = (t: { input: number; output: number; cacheRead: number; cacheWrite: number }) =>
  t.input + t.output + t.cacheRead + t.cacheWrite

/**
 * 本机时钟比服务器快多少毫秒：云端的 createdAt 是请求结束的时间（服务器时钟），
 * 找本机记录和云端调用 token 完全一样的，取「本机结束时间 − createdAt」的中位数；找不到就当没有时钟差
 */
export function clockOffset(turns: BackfillTurn[], calls: RemoteCall[]): number {
  const diffs: number[] = []
  for (const turn of turns)
    for (const row of turn.rows) {
      if (tokens(row) < FINGERPRINT_MIN_TOKENS) continue
      const same = calls.filter(
        c =>
          c.model === row.model &&
          c.input === row.input &&
          c.output === row.output &&
          c.cacheRead === row.cacheRead &&
          c.cacheWrite === row.cacheWrite &&
          Math.abs(row.endedAt - c.createdAt) < FINGERPRINT_MS,
      )
      if (same.length === 1) diffs.push(row.endedAt - same[0].createdAt)
    }
  if (!diffs.length) return 0
  diffs.sort((a, b) => a - b)
  return diffs[Math.floor(diffs.length / 2)]
}

/**
 * 每次调用归到它开始时正在进行的那一轮：开始时间 = createdAt + 时钟差 − 耗时。
 * 前后各放宽 SLACK_MS；落在几轮里时归给离得最近的，一样近（并行的会话）归给最短的那一轮。
 * 一次调用最多归一轮；返回 轮次 key → 模型 → 合计。
 */
export function matchCalls(
  turns: BackfillTurn[],
  calls: RemoteCall[],
  offset: number,
): Map<string, Map<string, BackfillCharge>> {
  const out = new Map<string, Map<string, BackfillCharge>>()
  for (const c of calls) {
    if (c.costUsd === null || !Number.isFinite(c.costUsd) || c.costUsd < 0) continue
    const start = c.createdAt + offset - (c.durationMs || 0)
    let best: BackfillTurn | null = null,
      bestGap = Infinity
    for (const turn of turns) {
      if (start < turn.startedAt - SLACK_MS || start > turn.endedAt + SLACK_MS) continue
      const gap = Math.max(0, turn.startedAt - start, start - turn.endedAt)
      if (gap < bestGap || (gap === bestGap && best && turn.endedAt - turn.startedAt < best.endedAt - best.startedAt)) {
        best = turn
        bestGap = gap
      }
    }
    if (!best) continue
    let models = out.get(best.key)
    if (!models) out.set(best.key, (models = new Map()))
    let m = models.get(c.model)
    if (!m) models.set(c.model, (m = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 }))
    m.requests++
    m.input += c.input
    m.output += c.output
    m.cacheRead += c.cacheRead
    m.cacheWrite += c.cacheWrite
    m.costUsd += c.costUsd
    // 余额和订阅混在一轮里时按余额显示（订阅不显示金额会让人以为没花钱）
    if (c.billing) m.billing = m.billing && m.billing !== c.billing ? 'balance' : c.billing
  }
  return out
}

/**
 * 补录后这一轮的记录：对上的模型换成实扣（多出来的模型新加一行）；
 * 一次都没对上、本机也没收到任何 token 的（请求在开头就取消了），平台没扣钱，记为实扣 $0；
 * 其余没对上的标成 'none'，以后不再重试。
 */
export function backfillRows(turn: BackfillTurn, charges: Map<string, BackfillCharge> | undefined): UsageRecord[] {
  if (!charges?.size) {
    const zero = turn.rows.every(r => tokens(r) === 0)
    return turn.rows.map(r =>
      zero ? { ...r, costUsd: 0, costSource: 'platform', costMatch: 'time' } : { ...r, costMatch: 'none' },
    )
  }
  const rows: UsageRecord[] = []
  for (const r of turn.rows) {
    const c = charges.get(r.model)
    rows.push(c ? settled(r, r.model, c) : { ...r, costMatch: 'none' })
  }
  for (const [model, c] of charges)
    if (!turn.rows.some(r => r.model === model)) rows.push(settled(turn.rows[0], model, c))
  return rows
}

function settled(base: UsageRecord, model: string, c: BackfillCharge): UsageRecord {
  const { billing, ...rest } = c
  return {
    ...base,
    id: `${base.sessionId}:${base.turnId}:${model}`,
    model,
    ...rest,
    costSource: 'platform',
    ...(billing ? { billing } : {}),
    costMatch: 'time',
  }
}
