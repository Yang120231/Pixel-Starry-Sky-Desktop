// 压缩上下文的实时进度：本机网关报来压缩请求的进度，这里对到正在进行的压缩条目上，发 compaction_progress 给界面；
// 压缩条目结束时清掉进度，把汇总（实际模型、首字用时、摘要 token、请求次数）补进条目，详情里看
import type { CompactionProgress, EngineEvent, Item } from '@pixelsky/protocol'
import type { CompactionRequestReport } from '../compaction'
import type { HostContext } from './context'

type ItemEvent = Extract<EngineEvent, { type: 'item_started' | 'item_completed' }>

/** 网关的报告比 Claude Code 的 status 帧先到时，留多久等压缩条目 */
const PENDING_MS = 10_000

interface Tracked {
  itemId: string
  /** 这次压缩见过的请求，按先后 */
  requests: string[]
  progress: CompactionProgress | null
}

const runningCompaction = (items: readonly Item[]): Item | undefined =>
  items.findLast(item => item.kind === 'compaction' && item.status === 'running')

export class HostCompaction {
  private readonly tracked = new Map<string, Tracked>()
  private readonly pending = new Map<string, { at: number; report: CompactionRequestReport }>()

  constructor(private readonly ctx: HostContext) {}

  /** 网关的报告；会话没在压缩时先留着，压缩条目一开始就接上 */
  report(id: string, report: CompactionRequestReport): void {
    const rt = this.ctx.runtimes.get(id)
    if (!rt) return
    const item = runningCompaction(rt.snapshot.items)
    if (item) this.merge(id, item.id, report)
    else this.pending.set(id, { at: Date.now(), report })
  }

  private merge(id: string, itemId: string, report: CompactionRequestReport): void {
    let t = this.tracked.get(id)
    if (!t || t.itemId !== itemId) t = { itemId, requests: [], progress: null }
    if (!t.requests.includes(report.requestId)) t.requests.push(report.requestId)
    this.tracked.set(id, t)
    // 上一次请求迟到的报告不盖掉新请求的进度
    if (report.requestId !== t.requests.at(-1)) return
    const { requestId: _, ...fields } = report
    t.progress = { itemId, requests: t.requests.length, ...fields }
    this.ctx.m.events.apply(id, { type: 'compaction_progress', progress: t.progress })
  }

  /** 压缩条目结束：补上汇总 */
  withSummary(id: string, event: ItemEvent): ItemEvent {
    const item = event.item
    if (item.kind !== 'compaction' || item.status === 'running') return event
    const t = this.tracked.get(id)
    const p = t?.itemId === item.id ? t.progress : null
    if (!t || !p) return event
    return {
      ...event,
      item: {
        ...item,
        model: p.model,
        firstTokenMs: p.firstTokenAt === null ? null : p.firstTokenAt - p.requestAt,
        outputTokens: p.outputTokens > 0 ? p.outputTokens : null,
        requests: t.requests.length,
      },
    }
  }

  /** 压缩条目应用之后：开始时接上先到的报告，结束时清掉进度 */
  itemApplied(id: string, item: Item): void {
    if (item.kind !== 'compaction') return
    if (item.status === 'running') {
      const early = this.pending.get(id)
      this.pending.delete(id)
      if (early && Date.now() - early.at < PENDING_MS) this.merge(id, item.id, early.report)
      return
    }
    if (this.ctx.runtimes.get(id)?.snapshot.compaction)
      this.ctx.m.events.apply(id, { type: 'compaction_progress', progress: null })
  }

  forget(id: string): void {
    this.tracked.delete(id)
    this.pending.delete(id)
  }
}
