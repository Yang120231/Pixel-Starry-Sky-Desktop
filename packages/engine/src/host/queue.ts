// 消息队列：发送、排队、撤回、调序、继续、插队、引导（docs/ui/message-queue.md）
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import type { MessageInput, QueuedMessage, QueueSummary, SendReceipt } from '@pixelsky/protocol'
import { messageWithFiles } from '@pixelsky/protocol'
import { messageInput, queueSettings, sameQueueSettings } from '../queue'
import { ENGINES } from '../registry'
import type { HostContext } from './context'

export class HostQueue {
  /** 没打开过的会话读一次已保存的队列（之后由运行时接管），任务 › 待处理用（docs/ui/tasks-inbox.md §4） */
  private readonly queueHints = new Map<string, QueueSummary | null>()
  /** 上次广播时的队列状态：只在「有排队且暂停」或排队数变化时重新广播会话列表 */
  private readonly queueKeys = new Map<string, string>()

  constructor(private readonly ctx: HostContext) {}

  queueSummary(id: string): QueueSummary | null {
    const rt = this.ctx.runtimes.get(id)
    if (rt) {
      const queue = rt.snapshot.queue
      if (!queue.length) return null
      const failed = queue.filter(q => q.status === 'failed' || q.status === 'uncertain').length
      return { queued: queue.length - failed, failed, paused: rt.snapshot.queuePaused }
    }
    if (!this.queueHints.has(id)) this.queueHints.set(id, this.ctx.store.peekQueue(id))
    return this.queueHints.get(id) ?? null
  }

  /** 会话删除后清掉缓存的队列状态 */
  forget(id: string): void {
    this.queueHints.delete(id)
    this.queueKeys.delete(id)
  }

  async send(id: string, input: string | MessageInput): Promise<SendReceipt> {
    const { ctx } = this
    const m = ctx.m
    if (ctx.closing) throw new Error('应用正在退出')
    if (ctx.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const rt = m.sessions.runtime(id)
    if (m.guard.isLocked(rt.snapshot.record.cwd)) throw new Error('工作目录正在维护，请稍后重试')
    if (!statSync(rt.snapshot.record.cwd).isDirectory()) throw new Error('项目目录不存在')
    const v = messageInput(input, rt.snapshot.record, randomUUID)
    if (v.attachments?.length && !ENGINES[rt.snapshot.record.engine].caps.imageInput)
      throw new Error('当前引擎不支持图片输入')
    const duplicate = rt.receipts.find(r => r.queueId === v.clientMessageId)
    if (duplicate) return duplicate
    if (rt.snapshot.queue.some(q => q.id === v.clientMessageId)) return { queueId: v.clientMessageId, status: 'queued' }
    const item: QueuedMessage = {
      id: v.clientMessageId,
      text: v.text,
      attachments: v.attachments,
      ...(v.files ? { files: v.files } : {}),
      settings: v.settings,
      createdAt: Date.now(),
      status: 'queued',
      error: null,
      mode: 'normal',
    }
    // 没有对话在运行：用户这次发送就是「现在执行」。之前暂停的排队项单独保持暂停，
    // 失败 / 待核对项留给用户处理，都不会挡住这条，也不会被它顺带执行。
    const idle = rt.snapshot.state === 'idle' && !rt.pumping && !rt.stopping && !rt.activeId
    const held = idle && rt.snapshot.queuePaused
    const queue = rt.snapshot.queue.map(q => (held && q.status === 'queued' ? { ...q, held: true } : q))
    // 前面没有会先执行的排队项时，这条就是「现在执行」，界面不把它当排队显示。
    if (idle && !queue.some(q => q.status === 'queued' && !q.held)) item.direct = true
    const next = { ...rt.snapshot, queue: [...queue, item], queuePaused: idle ? false : rt.snapshot.queuePaused }
    // 先落盘，再承诺接收；磁盘失败时保持原快照，输入框原文不会被清空。
    ctx.store.saveQueue(id, { items: next.queue, paused: next.queuePaused, receipts: rt.receipts })
    rt.snapshot = next
    if (rt.snapshot.record.archivedAt) m.events.patchRecord(id, { archivedAt: null })
    if (rt.snapshot.suggestion) m.events.apply(id, { type: 'suggestion', text: null })
    this.publishQueue(id)
    queueMicrotask(() => {
      void m.turn.pump(id)
    })
    return { queueId: item.id, status: 'queued' }
  }

  publishQueue(id: string): void {
    const { ctx } = this
    const rt = ctx.m.sessions.runtime(id)
    ctx.store.saveQueue(id, { items: rt.snapshot.queue, paused: rt.snapshot.queuePaused, receipts: rt.receipts })
    ctx.m.events.apply(id, { type: 'queue', items: rt.snapshot.queue, paused: rt.snapshot.queuePaused })
    const key = rt.snapshot.queuePaused && rt.snapshot.queue.length ? `p${rt.snapshot.queue.length}` : ''
    if ((this.queueKeys.get(id) ?? '') !== key) {
      this.queueKeys.set(id, key)
      ctx.m.events.broadcastSessions()
    }
  }

  changeQueue(id: string, queueId: string, patch: Partial<QueuedMessage>): void {
    const rt = this.ctx.m.sessions.runtime(id)
    rt.snapshot = { ...rt.snapshot, queue: rt.snapshot.queue.map(q => (q.id === queueId ? { ...q, ...patch } : q)) }
    this.publishQueue(id)
  }

  removeQueue(id: string, queueId: string, status: SendReceipt['status']): void {
    const rt = this.ctx.m.sessions.runtime(id)
    rt.receipts = [...rt.receipts.filter(r => r.queueId !== queueId), { queueId, status }].slice(-256)
    rt.snapshot = { ...rt.snapshot, queue: rt.snapshot.queue.filter(q => q.id !== queueId) }
    this.publishQueue(id)
  }

  cancelQueued(id: string, queueId: string): string {
    const item = this.ctx.m.sessions.runtime(id).snapshot.queue.find(q => q.id === queueId)
    if (!item) throw new Error('这条消息已开始处理或已经撤回')
    if (['running', 'dispatching', 'delivering'].includes(item.status)) throw new Error('这条消息已开始交付，无法撤回')
    this.removeQueue(id, queueId, 'cancelled')
    return item.text
  }

  moveQueued(id: string, queueId: string, toIndex: number): void {
    const rt = this.ctx.m.sessions.runtime(id)
    const source = rt.snapshot.queue.findIndex(q => q.id === queueId)
    if (source < 0 || rt.snapshot.queue[source].status !== 'queued') throw new Error('只有排队中的消息可以调序')
    const items = [...rt.snapshot.queue]
    const item = items.splice(source, 1)[0]
    const index = Math.max(0, Math.min(items.length, Math.trunc(toIndex)))
    items.splice(index, 0, item)
    rt.snapshot = { ...rt.snapshot, queue: items }
    this.publishQueue(id)
  }

  resumeQueue(id: string): void {
    const { ctx } = this
    const m = ctx.m
    if (ctx.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const rt = m.sessions.runtime(id)
    if (rt.stopping) throw new Error('正在停止当前任务，请稍后继续')
    // 失败 / 待核对项留给用户处理，继续时只派发排队中的消息。
    if (rt.snapshot.record.archivedAt) m.events.patchRecord(id, { archivedAt: null })
    rt.snapshot = {
      ...rt.snapshot,
      queuePaused: false,
      queue: rt.snapshot.queue.map(q => (q.held ? { ...q, held: false } : q)),
    }
    this.publishQueue(id)
    queueMicrotask(() => {
      void m.turn.pump(id)
    })
  }

  async runQueuedNow(id: string, queueId: string): Promise<void> {
    const { ctx } = this
    const m = ctx.m
    if (ctx.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const rt = m.sessions.runtime(id)
    if (rt.stopping) throw new Error('正在停止当前任务，请稍后重试')
    const item = rt.snapshot.queue.find(q => q.id === queueId)
    if (!item || ['dispatching', 'running', 'delivering'].includes(item.status)) throw new Error('这条消息已经开始交付')
    await m.turn.interrupt(id)
    await rt.pumpFinished
    if (ctx.runtimes.get(id) !== rt || ctx.closing) throw new Error('会话已关闭')
    // 中断可能与完成事件竞争，仍使用稳定 ID 领取选中的任务。
    if (!rt.snapshot.queue.some(q => q.id === queueId)) throw new Error('这条消息已经开始处理')
    if (rt.snapshot.state !== 'idle' || rt.pumping) throw new Error('当前任务还没有停止，请稍后重试')
    if (rt.snapshot.record.archivedAt) m.events.patchRecord(id, { archivedAt: null })
    rt.snapshot = {
      ...rt.snapshot,
      queue: [
        { ...item, status: 'queued', mode: 'normal', error: null, held: false, direct: true },
        ...rt.snapshot.queue.filter(q => q.id !== queueId),
      ],
      queuePaused: false,
    }
    this.publishQueue(id)
    await m.turn.pump(id)
  }

  async steerQueued(id: string, queueId: string, expectedTurnId: string): Promise<void> {
    const rt = this.ctx.m.sessions.runtime(id)
    if (rt.snapshot.state !== 'running' || rt.snapshot.turnId !== expectedTurnId || rt.stopping)
      throw new Error('当前一轮已结束或正在等待审批')
    if (!rt.snapshot.flags.steerAvailable || !rt.session?.steer)
      throw new Error('当前引擎尚未通过运行中引导验证，可等待或插队')
    const item = rt.snapshot.queue.find(q => q.id === queueId && q.status === 'queued')
    if (!item) throw new Error('这条消息已经开始交付')
    if (!sameQueueSettings(item.settings, queueSettings(rt.execution ?? rt.snapshot.record)))
      throw new Error('设置与当前任务不同，可等待或插队')
    this.changeQueue(id, queueId, { status: 'delivering', mode: 'guidance' })
    try {
      await rt.session.steer(messageWithFiles(item.text, item.files), item.id, item.attachments)
    } catch (err) {
      this.changeQueue(id, queueId, { status: 'uncertain', error: `引导交付结果待核对：${(err as Error).message}` })
      rt.snapshot = { ...rt.snapshot, queuePaused: true }
      this.publishQueue(id)
      throw err
    }
  }
}
