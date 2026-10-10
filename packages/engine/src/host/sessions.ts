// 会话：创建、打开（懒创建运行时）、改设置、改名、置底、回退、归档、删除
import { randomUUID } from 'node:crypto'
import {
  emptySnapshot,
  normalizeSessionTitle,
  type EngineId,
  type OpenedSession,
  type SessionRecord,
  type SessionSettings,
  type SessionSnapshot,
  type SessionSummary,
} from '@pixelsky/protocol'
import { queueSettings } from '../queue'
import { ENGINES } from '../registry'
import type { HostContext, Runtime } from './context'
import { NEW_TITLE } from './title'

export class HostSessions {
  constructor(private readonly ctx: HostContext) {}

  sessions(): SessionSummary[] {
    const { ctx } = this
    return [...ctx.records.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(record => {
        const queue = ctx.m.queue.queueSummary(record.id)
        return { record, state: ctx.runtimes.get(record.id)?.snapshot.state ?? 'idle', ...(queue ? { queue } : {}) }
      })
  }

  createSession(
    opts: { projectId: string } & Partial<SessionSettings> & { engine?: EngineId },
    workspacePath?: string,
  ): SessionRecord {
    const { ctx } = this
    const m = ctx.m
    const project = m.projects.find(opts.projectId)
    if (!project) throw new Error('项目不存在')
    if (m.guard.isLocked(workspacePath ?? project.path)) throw new Error('工作目录正在维护，请稍后重试')
    const engine = opts.engine ?? m.settings.file.defaults.engine
    const d = m.settings.engineDefaults(engine)
    const now = Date.now()
    const record: SessionRecord = {
      id: randomUUID(),
      projectId: project.id,
      cwd: workspacePath ?? project.path,
      engine,
      engineSessionId: null,
      title: NEW_TITLE,
      model: opts.model !== undefined ? opts.model : d.model,
      platform: opts.platform ?? null,
      effort: opts.effort !== undefined ? opts.effort : d.effort,
      permissionMode: opts.permissionMode ?? d.permissionMode,
      ultracode: opts.ultracode ?? d.ultracode,
      fast: opts.fast ?? d.fast,
      thinkingSummaries: opts.thinkingSummaries ?? d.thinkingSummaries,
      createdAt: now,
      updatedAt: now,
      lastOutcome: null,
      archivedAt: null,
      bottomedAt: null,
      titleEdited: false,
    }
    ctx.records.set(record.id, record)
    ctx.store.saveRecord(record)
    m.events.broadcastSessions()
    return record
  }

  /** 会话的运行时；第一次访问时从磁盘读条目和队列，并排期续跑未完成的结算 */
  runtime(id: string): Runtime {
    const { ctx } = this
    let rt = ctx.runtimes.get(id)
    if (rt) return rt
    const record = ctx.records.get(id)
    if (!record) throw new Error('会话不存在')
    const snapshot = emptySnapshot(record, ctx.store.loadItems(id))
    if (record.platform)
      snapshot.items = snapshot.items.map(item =>
        item.kind === 'turn_stats' && !item.usage.settlement
          ? {
              ...item,
              usage: {
                ...item.usage,
                models: Object.fromEntries(
                  Object.entries(item.usage.models).map(([name, m]) => [
                    name,
                    m.costSource ? m : { ...m, costUsd: null, costSource: 'unavailable' as const },
                  ]),
                ),
              },
            }
          : item,
      )
    const saved = ctx.store.loadQueue(record)
    snapshot.queue = saved.items
    snapshot.queuePaused = saved.paused
    try {
      const runs = ctx.adapters[record.engine]?.loadRuns?.(record)
      if (runs) snapshot.runs = runs
    } catch {
      // 读不到以前的追踪数据不影响打开会话
    }
    rt = {
      snapshot,
      seq: 0,
      session: null,
      idleTimer: null,
      receipts: saved.receipts,
      pumping: false,
      stopping: false,
      generation: 0,
      activeId: null,
      execution: null,
      sessionSource: undefined,
      pumpFinished: null,
      sessionMaxRetries: undefined,
    }
    ctx.runtimes.set(id, rt)
    // The original account and request IDs are persisted, never inferred from the current route.
    queueMicrotask(() => {
      ctx.m.usage.resumeSettlements(id, snapshot.items)
    })
    return rt
  }

  open(id: string): SessionSnapshot {
    return this.runtime(id).snapshot
  }

  openSession(id: string): OpenedSession {
    const rt = this.runtime(id)
    this.ctx.m.usage.resumeSettlements(id, rt.snapshot.items)
    return { snapshot: rt.snapshot, seq: rt.seq }
  }

  /** 正在执行的设置（含运行中改过的）；没有运行时用会话记录。不创建运行时 */
  record(id: string): SessionRecord | null {
    return this.ctx.runtimes.get(id)?.execution ?? this.ctx.records.get(id) ?? null
  }

  async update(
    id: string,
    patch: Partial<SessionSettings> & { title?: string; engine?: EngineId },
  ): Promise<SessionRecord> {
    const m = this.ctx.m
    const rt = this.runtime(id)
    if (rt.inspectingContext) throw new Error('上下文诊断正在刷新，完成后再修改会话设置')
    const current = rt.snapshot.record
    const next: Partial<SessionRecord> = {}
    let restart = false
    if (patch.platform !== undefined && JSON.stringify(patch.platform) !== JSON.stringify(current.platform ?? null)) {
      const before = current.platform ?? null
      const sameSource = before === null ? patch.platform === null : patch.platform?.account === before.account
      if (!sameSource && (rt.snapshot.state !== 'idle' || rt.pumping)) throw new Error('这一轮结束后再切换额度来源')
      if (!sameSource && rt.session) {
        if (rt.snapshot.state !== 'idle') throw new Error('这一轮结束后再切换额度来源')
        restart = true
      }
      next.platform = patch.platform
    }
    if (patch.title !== undefined) {
      next.title = normalizeSessionTitle(patch.title)
      next.titleEdited = true
    }
    if (patch.model !== undefined) next.model = patch.model
    if (patch.effort !== undefined) next.effort = patch.effort
    if (patch.permissionMode !== undefined) next.permissionMode = patch.permissionMode
    if (patch.ultracode !== undefined) next.ultracode = patch.ultracode
    if (patch.fast !== undefined) next.fast = patch.fast
    if (patch.thinkingSummaries !== undefined) next.thinkingSummaries = patch.thinkingSummaries
    if (patch.engine !== undefined && patch.engine !== current.engine) {
      if (rt.snapshot.items.length > 0 || rt.session || rt.pumping || rt.snapshot.queue.length > 0)
        throw new Error('已经开始对话或有排队任务的会话不能换引擎，请新建会话')
      next.engine = patch.engine
    }
    const record = m.events.patchRecord(id, next)
    if (rt.execution) {
      const applied = { ...next }
      if (!ENGINES[current.engine].caps.liveModelSwitch && rt.snapshot.state !== 'idle') {
        delete applied.model
        delete applied.effort
      }
      if (!ENGINES[current.engine].caps.livePermissionSwitch && rt.snapshot.state !== 'idle')
        delete applied.permissionMode
      rt.execution = { ...rt.execution, ...applied }
    }
    if (rt.execution) m.events.apply(id, { type: 'execution', settings: queueSettings(rt.execution) })
    const settings: Partial<SessionSettings> = {}
    if (patch.model !== undefined) settings.model = patch.model
    if (patch.effort !== undefined) settings.effort = patch.effort
    if (patch.permissionMode !== undefined) settings.permissionMode = patch.permissionMode
    if (patch.ultracode !== undefined) settings.ultracode = patch.ultracode
    if (patch.fast !== undefined) settings.fast = patch.fast
    if (patch.thinkingSummaries !== undefined) settings.thinkingSummaries = patch.thinkingSummaries
    if (restart && rt.session) {
      if (rt.idleTimer) {
        clearTimeout(rt.idleTimer)
        rt.idleTimer = null
      }
      const s = rt.session
      rt.session = null
      await s.close()
    }
    if (Object.keys(settings).length > 0) {
      // 记住用户的选择，作为以后新会话的默认值
      m.settings.setDefaults({ ...settings, engine: record.engine })
      await rt.session?.update(settings)
    }
    return record
  }

  renameSession(id: string, title: unknown): SessionRecord {
    if (this.ctx.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const name = normalizeSessionTitle(title),
      rt = this.runtime(id)
    const record = this.ctx.m.events.patchRecord(id, { title: name, titleEdited: true })
    if (rt.execution) rt.execution = { ...rt.execution, title: name, titleEdited: true }
    return record
  }

  setSessionBottom(id: string, bottomed: boolean): SessionRecord {
    if (this.ctx.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const rt = this.runtime(id)
    if (Boolean(rt.snapshot.record.bottomedAt) === bottomed) return rt.snapshot.record
    const stamp = bottomed
      ? [...this.ctx.records.values()].reduce(
          (latest, record) => Math.max(latest, (record.bottomedAt ?? 0) + 1),
          Date.now(),
        )
      : null
    const record = this.ctx.m.events.patchRecord(id, { bottomedAt: stamp })
    if (rt.execution) rt.execution = { ...rt.execution, bottomedAt: stamp }
    return record
  }

  async archiveSession(id: string, archived: boolean, stopRunning = false): Promise<void> {
    const { ctx } = this
    const m = ctx.m
    if (ctx.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const rt = this.runtime(id)
    if (Boolean(rt.snapshot.record.archivedAt) === archived) return
    if (archived && (rt.snapshot.state !== 'idle' || rt.pumping || rt.stopping) && !stopRunning)
      throw new Error('SESSION_RUNNING')
    ctx.changingSessions.add(id)
    try {
      if (archived) {
        await m.turn.interrupt(id)
        const old = rt.session
        rt.session = null
        await old?.close()
        if (rt.snapshot.turnId)
          m.events.onEngineEvent(id, {
            type: 'turn_completed',
            turnId: rt.snapshot.turnId,
            outcome: 'interrupted',
            error: null,
          })
      }
      m.events.patchRecord(id, { archivedAt: archived ? Date.now() : null })
    } finally {
      ctx.changingSessions.delete(id)
    }
  }

  async deleteSession(id: string): Promise<void> {
    const { ctx } = this
    const m = ctx.m
    if (ctx.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    ctx.changingSessions.add(id)
    try {
      m.cache.forget(id)
      const rt = ctx.runtimes.get(id)
      if (rt) {
        await m.turn.interrupt(id)
        rt.generation++
        if (rt.idleTimer) clearTimeout(rt.idleTimer)
        ctx.runtimes.delete(id)
        await rt.session?.close()
      }
      ctx.records.delete(id)
      m.queue.forget(id)
      ctx.store.deleteSession(id)
      m.events.broadcastSessions()
    } finally {
      ctx.changingSessions.delete(id)
    }
  }
}
