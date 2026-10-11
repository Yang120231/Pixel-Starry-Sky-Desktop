// 事件：apply 是唯一写快照的入口（先落盘再广播，seq 递增）；适配器发来的事件在这里推导运行状态
import { reduce, type EngineEvent, type SessionRecord } from '@pixelsky/protocol'
import type { HostContext } from './context'

export class HostEvents {
  constructor(private readonly ctx: HostContext) {}

  /** 应用一个事件：更新快照、保存、广播 */
  apply(id: string, event: EngineEvent): void {
    const { ctx } = this
    const rt = ctx.runtimes.get(id)
    if (!rt) return
    const before = rt.snapshot.items
    rt.snapshot = reduce(rt.snapshot, event)
    rt.seq++
    // 开始时也写一次：重开会话时条目按开始的先后排（和实时一致），没等到完成的也不会丢（读出时标成已中断）
    if (event.type === 'item_completed' || event.type === 'item_started') ctx.store.appendItem(id, event.item)
    // 一轮结束时收尾的条目（还在跑的标成完成 / 中断 / 失败）也要落盘，不然重开后状态不一致
    if (event.type === 'turn_completed' && rt.snapshot.items !== before) {
      const old = new Map(before.map(item => [item.id, item]))
      for (const item of rt.snapshot.items) if (old.get(item.id) !== item) ctx.store.appendItem(id, item)
    }
    if (event.type === 'record') {
      ctx.records.set(id, event.record)
      ctx.store.saveRecord(event.record)
    }
    ctx.opts.emit({ kind: 'session', sessionId: id, seq: rt.seq, event })
    if (event.type === 'status' || event.type === 'record') this.broadcastSessions()
  }

  patchRecord(id: string, patch: Partial<SessionRecord>): SessionRecord {
    const rt = this.ctx.m.sessions.runtime(id)
    if (
      patch.model !== undefined ||
      patch.platform !== undefined ||
      patch.provider !== undefined ||
      patch.engine !== undefined
    ) {
      this.ctx.m.cache.reset(id)
      if (rt.snapshot.context)
        this.apply(id, { type: 'context', context: { ...rt.snapshot.context, stale: true, diagnosticStale: true } })
    }
    const record = { ...rt.snapshot.record, ...patch }
    this.apply(id, { type: 'record', record })
    return record
  }

  broadcastSessions(): void {
    this.ctx.opts.emit({ kind: 'sessions', sessions: this.ctx.m.sessions.sessions() })
  }

  /** 适配器发来的事件：在这里推导运行状态 */
  onEngineEvent(id: string, event: EngineEvent): void {
    const { ctx } = this
    const m = ctx.m
    const rt = ctx.runtimes.get(id)
    if (!rt) return
    // 已结束轮次的迟到 result 不能清理正在执行的新轮和审批。
    if (event.type === 'turn_completed' && event.turnId !== rt.snapshot.turnId) return
    if (event.type === 'request_cache_reset') {
      m.cache.reset(id)
      return
    }
    if (event.type === 'request_usage') {
      const r = event.request
      if (rt.snapshot.turnId !== r.turnId || rt.snapshot.state === 'idle' || rt.stopping) return
      m.cache.check(id, rt, r)
      return
    }
    this.apply(id, event)
    switch (event.type) {
      case 'turn_started':
        // 适配器自己开的一轮（后台任务通知后引擎接着干活，没有用户消息）：和普通的一轮一样算运行中，
        // 空闲定时器不能在这时关掉进程
        if (rt.idleTimer) {
          clearTimeout(rt.idleTimer)
          rt.idleTimer = null
        }
        this.apply(id, { type: 'status', state: 'running' })
        break
      case 'approval_request':
        this.apply(id, { type: 'status', state: 'waiting' })
        break
      case 'approval_resolved':
        if (rt.snapshot.turnId && rt.snapshot.pending.length === 0) this.apply(id, { type: 'status', state: 'running' })
        break
      case 'turn_completed': {
        if (event.usage || m.usage.hasPlatformRequests(id, event.turnId))
          m.usage.recordUsage(id, event.turnId, event.outcome, event.usage ?? { models: {}, durationMs: 0 })
        this.patchRecord(id, {
          lastOutcome: event.outcome,
          lastError: event.outcome === 'failed' ? (event.error ?? '').slice(0, 500) || null : null,
          updatedAt: Date.now(),
        })
        if (rt.activeId) {
          const item = rt.snapshot.queue.find(q => q.id === rt.activeId)
          if (item && event.outcome === 'failed')
            m.queue.changeQueue(id, item.id, { status: 'failed', error: event.error ?? '任务执行失败' })
          else if (item) m.queue.removeQueue(id, item.id, 'accepted')
          rt.activeId = null
        }
        const awaitingGuidance = rt.snapshot.queue.some(q => q.status === 'delivering')
        if (!awaitingGuidance) rt.execution = null
        if (event.outcome !== 'completed') rt.snapshot = { ...rt.snapshot, queuePaused: true }
        m.queue.publishQueue(id)
        this.apply(id, { type: 'status', state: awaitingGuidance ? 'starting' : 'idle' })
        // 必须等适配器旧轮的 turnEnded / 审批清理回调返回，再派发下一条。
        queueMicrotask(() => {
          void m.turn.pump(id)
        })
        if (rt.snapshot.queuePaused || rt.snapshot.queue.length === 0) this.armIdle(id)
        break
      }
      case 'input_ack': {
        const input = rt.snapshot.queue.find(q => q.id === event.id && q.mode === 'guidance')
        if (input) {
          if (event.state === 'consumed') {
            this.apply(id, {
              type: 'item_completed',
              item: {
                kind: 'user',
                id: input.id,
                text: input.text,
                attachments: input.attachments,
                createdAt: Date.now(),
                mode: event.mode ?? 'guidance',
                turnId: rt.snapshot.turnId ?? undefined,
              },
            })
            m.queue.removeQueue(id, input.id, 'accepted')
          } else if (event.state === 'cancelled')
            m.queue.changeQueue(id, input.id, { status: 'queued', mode: 'normal', error: null })
          else {
            rt.snapshot = { ...rt.snapshot, queuePaused: true }
            m.queue.changeQueue(id, input.id, { status: 'uncertain', error: '引擎退出前未确认是否采纳，请核对后重试' })
          }
        }
        break
      }
    }
  }

  armIdle(id: string): void {
    const rt = this.ctx.runtimes.get(id)
    if (!rt) return
    if (rt.idleTimer) clearTimeout(rt.idleTimer)
    rt.idleTimer = setTimeout(() => {
      rt.idleTimer = null
      if (rt.snapshot.state !== 'idle' || !rt.session) return
      const s = rt.session
      rt.session = null
      void s.close()
    }, this.ctx.idleMs)
    rt.idleTimer.unref?.()
  }
}
