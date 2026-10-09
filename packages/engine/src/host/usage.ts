// 用量与调用记录、平台扣费结算（docs/ui/usage.md §6.2）
import type {
  Item,
  PlatformCharge,
  PlatformRequest,
  SessionRecord,
  TurnOutcome,
  TurnUsage,
  UsagePage,
  UsageRecord,
  UsageSummary,
} from '@pixelsky/protocol'
import { settleUsage } from '../billing'
import type { UsageQuery } from '../usage'
import type { HostContext } from './context'

export class HostUsage {
  private readonly platformRequests = new Map<string, PlatformRequest[]>()
  private readonly settlements = new Map<string, AbortController>()
  /** 清空用量时加一；进行中的结算不再写回已清空的记录 */
  private epoch = 0

  constructor(private readonly ctx: HostContext) {}

  /** Capture the execution before the gateway awaits I/O; late requests cannot move to a later turn. */
  platformRequestContext(record: SessionRecord): ((requestId: string, model: string) => void) | undefined {
    const rt = this.ctx.runtimes.get(record.id),
      turnId = rt?.snapshot.turnId
    if (!rt || !turnId || !record.platform) return
    const key = `${record.id}:${turnId}`,
      groupId = record.platform.groupId
    return (requestId, model) => {
      if (rt.snapshot.turnId !== turnId || this.ctx.closing) return
      const requests = this.platformRequests.get(key) ?? []
      requests.push({ id: requestId, model, groupId })
      this.platformRequests.set(key, requests)
    }
  }

  /** 这一轮经平台网关发过请求（引擎没报用量也要记一行待结算） */
  hasPlatformRequests(id: string, turnId: string): boolean {
    return this.platformRequests.has(`${id}:${turnId}`)
  }

  /** 一轮结束：按模型写用量记录，并在对话流里加一行统计（显示在这一轮回复下方） */
  recordUsage(id: string, turnId: string, outcome: TurnOutcome, usage: TurnUsage): void {
    const { ctx } = this
    const rt = ctx.runtimes.get(id)
    if (!rt) return
    const record = rt.execution ?? rt.snapshot.record
    const key = `${id}:${turnId}`
    if (record.platform) {
      usage = settleUsage(
        {
          ...usage,
          settlement: {
            account: record.platform.account,
            requests: this.platformRequests.get(key) ?? [],
            startedAt: Date.now() - usage.durationMs,
            complete: false,
          },
        },
        [],
        false,
      )
    }
    this.platformRequests.delete(key)
    const endedAt = Date.now()
    const project = ctx.m.projects.find(record.projectId)?.name ?? null
    const rows: UsageRecord[] = Object.entries(usage.models).map(([model, m]) => ({
      v: 1,
      id: `${id}:${turnId}:${model}`,
      sessionId: id,
      turnId,
      startedAt: endedAt - usage.durationMs,
      endedAt,
      durationMs: usage.durationMs,
      sessionTitle: record.title,
      project,
      engine: record.engine,
      model,
      // 目前引擎都用命令行自己的登录；像素星空账号网关做好后是 'pixelsky'（Q5）
      route: record.platform ? 'pixelsky' : 'cli',
      requests: m.requests,
      input: m.input,
      cacheRead: m.cacheRead,
      cacheWrite: m.cacheWrite,
      output: m.output,
      costUsd: m.costUsd,
      costSource: m.costSource ?? 'estimate',
      billing: m.billing,
      outcome,
    }))
    try {
      ctx.usage.append(rows)
    } catch {
      // 写不进去（磁盘满、权限）不影响对话
    }
    ctx.m.events.apply(id, {
      type: 'item_completed',
      item: { kind: 'turn_stats', id: `stats-${turnId}`, turnId, outcome, usage },
    })
    ctx.opts.emit({ kind: 'usage_recorded' })
    if (usage.settlement) this.startSettlement(id, turnId, outcome, usage)
  }

  /** 已保存的统计里还没结算完的，继续结算（原账号和请求 ID 都已落盘，不按当前路由推断） */
  resumeSettlements(id: string, items: readonly Item[]): void {
    for (const item of items)
      if (item.kind === 'turn_stats' && item.usage.settlement && !item.usage.settlement.complete)
        this.startSettlement(id, item.turnId, item.outcome, item.usage)
  }

  private startSettlement(id: string, turnId: string, outcome: TurnOutcome, original: TurnUsage): void {
    const { ctx } = this
    const key = `${id}:${turnId}`
    if (ctx.closing || this.settlements.has(key) || !original.settlement?.requests.length) return
    const controller = new AbortController(),
      epoch = this.epoch
    this.settlements.set(key, controller)
    const charges = new Map<string, PlatformCharge>()
    const delays = ctx.opts.settlementDelays ?? [1000, 3000, 10000, 30000, 60000]
    void (async () => {
      for (let attempt = 0; attempt < delays.length; attempt++) {
        await new Promise<void>(resolve => {
          const done = () => {
            clearTimeout(timer)
            controller.signal.removeEventListener('abort', done)
            resolve()
          }
          const timer = setTimeout(done, delays[attempt])
          timer.unref()
          controller.signal.addEventListener('abort', done, { once: true })
        })
        if (controller.signal.aborted || ctx.closing || !ctx.records.has(id)) return
        try {
          const result = await ctx.opts.platformCharges?.(original.settlement!, controller.signal)
          for (const charge of result ?? []) charges.set(charge.requestId, charge)
        } catch {
          /* asynchronous billing or expired authentication: keep pending until the final attempt */
        }
        if (controller.signal.aborted || ctx.closing || !ctx.records.has(id)) return
        const usage = settleUsage(original, [...charges.values()], attempt === delays.length - 1)
        // Update only existing statistics. A rewind must not resurrect discarded messages.
        const rt = ctx.runtimes.get(id)
        if (rt?.snapshot.items.some(item => item.id === `stats-${turnId}`)) {
          ctx.m.events.apply(id, {
            type: 'item_completed',
            item: { kind: 'turn_stats', id: `stats-${turnId}`, turnId, outcome, usage },
          })
        }
        if (epoch === this.epoch) {
          const rows = ctx.usage
            .load(original.settlement!.startedAt)
            .filter(row => row.sessionId === id && row.turnId === turnId)
          ctx.usage.append(
            rows.map(row => {
              const model = usage.models[row.model]
              return model ? { ...row, ...model } : row
            }),
          )
          ctx.opts.emit({ kind: 'usage_recorded' })
        }
        if (usage.settlement!.complete) return
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        if (this.settlements.get(key) === controller) this.settlements.delete(key)
      })
  }

  /** 退出应用：停掉所有进行中的结算 */
  abortSettlements(): void {
    for (const job of this.settlements.values()) job.abort()
  }

  usageSummary(q: UsageQuery): UsageSummary {
    return this.ctx.usage.summary(q)
  }

  usageList(q: UsageQuery & { offset: number; limit: number }): UsagePage {
    return this.ctx.usage.list(q)
  }

  usageCsv(q: UsageQuery): string {
    return this.ctx.usage.csv(q)
  }

  usageClear(): void {
    this.epoch++
    this.ctx.usage.clear()
    this.ctx.opts.emit({ kind: 'usage_recorded' })
  }
}
