// 一轮对话：派发排队消息（pump）、中断、审批应答、上下文诊断与压缩、后台任务、子智能体追踪
import { randomUUID } from 'node:crypto'
import type {
  ApprovalDecision,
  ContextDetailLevel,
  ContextDiagnostic,
  ExtensionLaunch,
  InterruptOptions,
  Item,
  SendReceipt,
  TaskOutput,
} from '@pixelsky/protocol'
import { sourceKey, viaGateway } from '@pixelsky/protocol'
import { queueSettings } from '../queue'
import type { HostContext } from './context'
import { NEW_TITLE, titleFrom } from './title'

export class HostTurn {
  constructor(private readonly ctx: HostContext) {}

  async pump(id: string): Promise<void> {
    const { ctx } = this
    const m = ctx.m
    const rt = ctx.runtimes.get(id)
    if (
      !rt ||
      m.guard.isLocked(rt.snapshot.record.cwd) ||
      ctx.closing ||
      ctx.changingSessions.has(id) ||
      rt.snapshot.record.archivedAt ||
      rt.pumping ||
      rt.stopping ||
      rt.inspectingContext ||
      rt.snapshot.state !== 'idle'
    )
      return
    // 失败 / 待核对和单独暂停的项不堵住队首，取第一条可执行的消息。
    const item = rt.snapshot.queuePaused ? undefined : rt.snapshot.queue.find(q => q.status === 'queued' && !q.held)
    if (!item) return
    rt.pumping = true
    let finishPump!: () => void
    rt.pumpFinished = new Promise<void>(resolve => {
      finishPump = resolve
    })
    const generation = rt.generation
    const stillCurrent = () =>
      !ctx.closing && ctx.runtimes.get(id) === rt && generation === rt.generation && !rt.snapshot.queuePaused
    m.queue.changeQueue(id, item.id, { status: 'dispatching' })
    m.events.apply(id, { type: 'status', state: 'starting' })
    let preparedExtensions: ExtensionLaunch | undefined
    try {
      let record = { ...rt.snapshot.record, ...item.settings }
      const adapter = ctx.adapters[record.engine]
      if (!adapter) throw new Error('这个引擎暂不支持')
      const info = await adapter.info()
      if (!stillCurrent()) return
      if (item.attachments?.length && !info.caps.imageInput) throw new Error('当前引擎不支持图片输入')
      if (info.status !== 'ready' && !(viaGateway(record) && info.status === 'unauthenticated'))
        throw new Error(info.message ?? `${info.name} 不可用`)
      await ctx.opts.validateInput?.(record)
      if (!stillCurrent()) return
      // 这条消息用的引擎和会话现在的不同（运行中选了别的引擎，或排队时就选了别的）：先切过去，用上面检测过的新引擎
      if (item.settings.engine && item.settings.engine !== rt.snapshot.record.engine) {
        await m.handoff.switchEngine(id, item.settings.engine)
        if (!stillCurrent()) return
        record = { ...rt.snapshot.record, ...item.settings }
      }
      if (rt.idleTimer) {
        clearTimeout(rt.idleTimer)
        rt.idleTimer = null
      }
      const source = sourceKey(record)
      const maxRetries = m.settings.file.maxRetries
      // 在换引擎之后准备：新引擎的第一条消息就带上按新记录（engineSessions 等）决定的扩展
      const extensions = (preparedExtensions = await ctx.opts.extensions?.(record))
      const launch = m.settings.launchKey(record.engine) + m.settings.modelLaunchKey(record) + (extensions?.key ?? '')
      // 额度来源、重试次数或引擎级设置（输出风格、允许提问、压缩触发点、路径、环境变量）变了：换一个进程，--resume 接上原对话
      if (
        rt.session &&
        (rt.sessionSource !== source || rt.sessionMaxRetries !== maxRetries || rt.sessionLaunch !== launch)
      ) {
        const old = rt.session
        rt.session = null
        await old.close()
      }
      if (!stillCurrent()) return
      // 执行设置里的引擎就是正在用的这个，nextEngine（还没生效的选择）不带进来
      rt.execution = { ...rt.snapshot.record, ...item.settings, nextEngine: null }
      if (!rt.session) {
        rt.sessionSource = source
        rt.sessionMaxRetries = maxRetries
        rt.sessionLaunch = launch
        rt.session = adapter.createSession({
          extensions,
          maxRetries,
          record: () => ({ ...m.sessions.runtime(id).snapshot.record, ...(m.sessions.runtime(id).execution ?? {}) }),
          emit: e => m.events.onEngineEvent(id, e),
          setEngineSessionId: engineSessionId => {
            if (rt.execution) rt.execution.engineSessionId = engineSessionId
            // 当前引擎在 engineSessions 里的 id 一起同步（旧记录没有 engineSessions，等第一轮结束时再建）
            const latest = rt.snapshot.record
            const engine = rt.execution?.engine ?? latest.engine
            const entry = latest.engineSessions?.[engine]
            m.events.patchRecord(id, {
              engineSessionId,
              ...(latest.engineSessions
                ? {
                    engineSessions: {
                      ...latest.engineSessions,
                      [engine]: { ...entry, id: engineSessionId, seen: entry?.seen ?? null },
                    },
                  }
                : {}),
            })
          },
          setPermissionMode: permissionMode => {
            if (rt.execution) rt.execution.permissionMode = permissionMode
            m.events.patchRecord(id, { permissionMode })
          },
          setUltracode: ultracode => {
            if (rt.execution) rt.execution.ultracode = ultracode
            m.events.patchRecord(id, { ultracode })
          },
          setFast: fast => {
            if (rt.execution) rt.execution.fast = fast
            m.events.patchRecord(id, { fast })
          },
          clearPendingRewind: () => {
            if (rt.execution) rt.execution.pendingRewind = null
            m.events.patchRecord(id, { pendingRewind: null })
          },
          clearPendingFork: () => {
            if (rt.execution) rt.execution.pendingFork = null
            m.events.patchRecord(id, { pendingFork: null })
          },
        })
        preparedExtensions = undefined
      } else {
        extensions?.dispose?.()
        preparedExtensions = undefined
        await rt.session.update(rt.execution, true)
      }
      if (!stillCurrent()) return
      const turnId = randomUUID()
      const userItemId = item.attempt ? `${item.id}-retry-${randomUUID()}` : item.id
      // 新引擎没看过的对话整理成交接材料，放在用户消息前面发给它；用户消息条目里仍是用户原文
      const handoff = m.handoff.plan(id, record, item.text, item.files)
      rt.holdCursor = handoff.hold ? turnId : undefined
      rt.activeId = item.id
      m.queue.changeQueue(id, item.id, { status: 'running', attempt: (item.attempt ?? 0) + 1, messageUuid: userItemId })
      if (handoff.notice) m.events.apply(id, { type: 'item_completed', item: handoff.notice })
      m.events.apply(id, {
        type: 'item_completed',
        item: {
          kind: 'user',
          id: userItemId,
          text: item.text,
          attachments: item.attachments,
          ...(item.files ? { files: item.files } : {}),
          createdAt: Date.now(),
          mode: 'normal',
          turnId,
          engine: record.engine,
        },
      })
      const latest = rt.snapshot.record
      m.events.patchRecord(id, {
        title:
          !latest.titleEdited && latest.title === NEW_TITLE
            ? titleFrom(item.text || item.files?.[0]?.name || item.attachments?.[0]?.name || NEW_TITLE)
            : latest.title,
        updatedAt: Date.now(),
      })
      if (rt.snapshot.suggestion) m.events.apply(id, { type: 'suggestion', text: null })
      m.events.apply(id, { type: 'status', state: 'running' })
      m.events.apply(id, { type: 'turn_started', turnId, execution: queueSettings(rt.execution) })
      rt.session.send(handoff.text, turnId, userItemId, item.attachments, handoff.seed)
    } catch (err) {
      if (ctx.runtimes.get(id) !== rt) return
      m.queue.changeQueue(id, item.id, { status: 'failed', error: (err as Error).message })
      rt.snapshot = { ...rt.snapshot, queuePaused: true }
      m.queue.publishQueue(id)
      m.events.apply(id, { type: 'status', state: 'idle' })
    } finally {
      preparedExtensions?.dispose?.()
      rt.pumping = false
      rt.pumpFinished = null
      finishPump()
      if (!rt.activeId) {
        rt.execution = null
        if (rt.snapshot.queue.find(q => q.id === item.id)?.status === 'dispatching')
          m.queue.changeQueue(id, item.id, { status: 'queued', direct: false })
        if (rt.snapshot.state === 'starting') m.events.apply(id, { type: 'status', state: 'idle' })
      }
    }
  }

  /**
   * 刷新上下文明细。引擎支持 get_context_usage（flags.contextLive）时运行中也能直接取，不占队列；
   * 否则（或会话空闲、进程可能要重新启动时）仍按原流程：空闲、无排队，期间暂停派发。
   */
  async inspectContext(id: string, detail: ContextDetailLevel = 'full'): Promise<ContextDiagnostic> {
    const { ctx } = this
    const rt = ctx.m.sessions.runtime(id)
    const busy =
      rt.snapshot.state !== 'idle' || rt.snapshot.queue.length || rt.pumping || rt.stopping || rt.inspectingContext
    if (!ctx.closing && busy && rt.snapshot.flags.contextLive && rt.session?.context && !rt.inspectingContext)
      return rt.session.context(detail)
    if (ctx.closing || busy) throw new Error('等待当前任务和排队消息结束后刷新明细')
    if (!rt.session?.context || !(rt.snapshot.flags.contextAvailable || rt.snapshot.flags.contextLive))
      throw new Error('先运行会话，或升级到支持上下文诊断的 Claude Code')
    if (rt.idleTimer) {
      clearTimeout(rt.idleTimer)
      rt.idleTimer = null
    }
    rt.inspectingContext = true
    try {
      return await rt.session.context(detail)
    } finally {
      rt.inspectingContext = false
      ctx.m.events.armIdle(id)
      queueMicrotask(() => {
        void this.pump(id)
      })
    }
  }

  async compactContext(id: string): Promise<SendReceipt> {
    const { ctx } = this
    const rt = ctx.m.sessions.runtime(id)
    if (
      ctx.closing ||
      rt.snapshot.state !== 'idle' ||
      rt.snapshot.queue.length ||
      rt.pumping ||
      rt.stopping ||
      rt.inspectingContext
    )
      throw new Error('等待当前任务和排队消息结束后压缩')
    if (!rt.session || !rt.snapshot.flags.compactAvailable) throw new Error('当前引擎不支持原生压缩，或会话尚未开始')
    const receipt = await ctx.m.queue.send(id, '/compact')
    if (rt.snapshot.context)
      ctx.m.events.apply(id, {
        type: 'context',
        context: { ...rt.snapshot.context, stale: true, compacting: true, diagnosticStale: true },
      })
    return receipt
  }

  async interrupt(id: string, opts?: InterruptOptions): Promise<void> {
    const m = this.ctx.m
    const rt = m.sessions.runtime(id)
    rt.generation++
    rt.snapshot = { ...rt.snapshot, queuePaused: true }
    m.queue.publishQueue(id)
    if (rt.stopping) return
    rt.stopping = true
    try {
      await rt.session?.interrupt(opts)
    } finally {
      rt.stopping = false
      if (!rt.snapshot.turnId && !rt.pumping) {
        rt.execution = null
        m.events.apply(id, { type: 'status', state: 'idle' })
      }
    }
  }

  async interruptTurn(id: string, expectedTurnId: string): Promise<boolean> {
    const rt = this.ctx.runtimes.get(id)
    if (!rt || rt.snapshot.turnId !== expectedTurnId || rt.snapshot.state === 'idle') return false
    await this.interrupt(id)
    return true
  }

  answer(id: string, requestId: string, decision: ApprovalDecision): void {
    const rt = this.ctx.runtimes.get(id)
    if (!rt?.session) return
    rt.session.answer(requestId, decision)
  }

  async stopTask(id: string, taskId: string): Promise<void> {
    const s = this.ctx.runtimes.get(id)?.session
    if (!s) throw new Error('引擎没有在运行')
    if (!s.stopTask) throw new Error('这个引擎没有后台任务')
    await s.stopTask(taskId)
  }

  async taskOutput(id: string, taskId: string): Promise<TaskOutput> {
    const s = this.ctx.runtimes.get(id)?.session
    if (!s) throw new Error('引擎没有在运行')
    if (!s.taskOutput) throw new Error('这个引擎没有后台任务')
    return s.taskOutput(taskId)
  }

  subagentTranscript(id: string, agentId: string): Item[] | Promise<Item[]> {
    const sessions = this.ctx.m.sessions
    const record = sessions.runtime(id).snapshot.record
    const adapter = this.ctx.adapters[record.engine]
    if (!adapter?.subagentTranscript) throw new Error('这个引擎没有智能体追踪')
    if (record.engine === 'codex' && !sessions.runtime(id).snapshot.runs.agents.some(agent => agent.id === agentId))
      throw new Error('子智能体不属于当前会话')
    return adapter.subagentTranscript(record, agentId)
  }
}
