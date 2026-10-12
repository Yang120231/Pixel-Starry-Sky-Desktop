// 回退（可恢复代码、可撤销）、分叉、旁聊（docs/ui/rewind-fork-sidechat.md §1–§3）
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative } from 'node:path'
import { normalizeSessionTitle } from '@pixelsky/protocol'
import type {
  ForkResult,
  Item,
  RewindCodePreview,
  RewindOptions,
  RewindPreview,
  RewindResult,
  SessionRecord,
  SideTurn,
} from '@pixelsky/protocol'
import { ENGINES } from '../registry'
import type { HostContext } from './context'

/** 还原代码前存一份当前内容，总共超过这个大小就不提供代码撤销 */
export const UNDO_LIMIT = 20 * 1024 * 1024

interface UndoEntry {
  /** 回退移除的条目；只恢复代码时为空 */
  removed: Item[]
  /** 回退时保留的条目数（之后回退可能加了一条提示，撤销时去掉） */
  kept: number
  before: Pick<SessionRecord, 'engineSessionId' | 'pendingRewind'>
  /** 回退后的状态：撤销时要求没变（没发新消息、引擎没接着跑） */
  after: Pick<SessionRecord, 'engineSessionId' | 'pendingRewind'> & { count: number; lastId: string | null }
  /** 还原前的文件内容；null 内容表示当时文件不存在。没动代码时为 null */
  files: { path: string; data: Buffer | null }[] | null
}

type UserItem = Extract<Item, { kind: 'user' }>

export class HostBranch {
  /** 每个会话最近一次回退，只在内存里（重启后不能撤销） */
  private readonly undo = new Map<string, UndoEntry>()
  private readonly sideQuestions = new Map<string, AbortController>()

  constructor(private readonly ctx: HostContext) {}

  private userItem(id: string, userItemId: string): { index: number; target: UserItem } {
    const rt = this.ctx.m.sessions.runtime(id)
    const index = rt.snapshot.items.findIndex(item => item.id === userItemId)
    const target = rt.snapshot.items[index]
    if (!target || target.kind !== 'user' || target.mode === 'guidance') throw new Error('只能回退到自己发送的消息')
    return { index, target }
  }

  private assertIdle(id: string): void {
    const { ctx } = this
    if (ctx.closing) throw new Error('应用正在退出')
    if (ctx.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const rt = ctx.m.sessions.runtime(id)
    if (rt.snapshot.state !== 'idle' || rt.pumping || rt.stopping || rt.activeId || rt.inspectingContext)
      throw new Error('请先停止当前任务再回退')
  }

  /** 关掉会话进程：它的上下文和文件检查点状态都要重新读 */
  private async closeProcess(id: string): Promise<void> {
    const rt = this.ctx.m.sessions.runtime(id)
    const old = rt.session
    rt.session = null
    if (rt.idleTimer) {
      clearTimeout(rt.idleTimer)
      rt.idleTimer = null
    }
    await old?.close()
  }

  /** 回退前检查代码：要还原哪些文件 */
  async rewindPreview(id: string, userItemId: string): Promise<RewindPreview> {
    const record = this.ctx.m.sessions.runtime(id).snapshot.record
    this.userItem(id, userItemId)
    return { code: await this.codePreview(record, userItemId) }
  }

  private async codePreview(record: SessionRecord, userItemId: string): Promise<RewindCodePreview> {
    const adapter = this.ctx.adapters[record.engine]
    if (!ENGINES[record.engine].caps.rewindCode || !adapter?.rewindFiles) return { ok: false, reason: 'unsupported' }
    if (!record.engineSessionId) return { ok: false, reason: 'no-checkpoint' }
    let reply
    try {
      reply = await adapter.rewindFiles(record, userItemId, true)
    } catch (err) {
      return { ok: false, reason: 'no-checkpoint', message: (err as Error).message }
    }
    if (!reply.ok) return { ok: false, reason: reply.reason, message: reply.message }
    let size = 0
    for (const file of reply.files) {
      try {
        size += statSync(file).size
      } catch {
        // 文件现在不存在：撤销时删掉还原出来的文件即可
      }
    }
    return {
      ok: true,
      files: reply.files.map(file => displayPath(record.cwd, file)),
      insertions: reply.insertions,
      deletions: reply.deletions,
      undoable: size <= UNDO_LIMIT,
    }
  }

  /**
   * 回退到某条用户消息之前：对话（移除它及之后的全部对话，引擎下次从它之前接上）和 / 或代码（文件改回它之前）。
   * 只在空闲时可用；回退对话时返回被移除消息的原文和图片，界面放回输入框。
   */
  async rewind(
    id: string,
    userItemId: string,
    options: RewindOptions = { conversation: true, code: false },
  ): Promise<RewindResult> {
    const { ctx } = this
    const m = ctx.m
    this.assertIdle(id)
    const rt = m.sessions.runtime(id)
    const record = rt.snapshot.record
    if (!ENGINES[record.engine].caps.rewind) throw new Error('当前引擎暂不支持回退')
    if (!options.conversation && !options.code) throw new Error('请选择要恢复的内容')
    const { index, target } = this.userItem(id, userItemId)
    const before = { engineSessionId: record.engineSessionId, pendingRewind: record.pendingRewind ?? null }
    ctx.changingSessions.add(id)
    try {
      await this.closeProcess(id)
      let files: UndoEntry['files'] = null
      if (options.code) files = await this.restoreCode(record, userItemId)
      const removed = options.conversation ? rt.snapshot.items.slice(index) : []
      if (options.conversation) this.truncate(id, index, userItemId)
      const now = m.sessions.runtime(id).snapshot
      this.undo.set(id, {
        removed,
        kept: options.conversation ? index : now.items.length,
        before,
        after: {
          engineSessionId: now.record.engineSessionId,
          pendingRewind: now.record.pendingRewind ?? null,
          count: now.items.length,
          lastId: now.items.at(-1)?.id ?? null,
        },
        files,
      })
      m.events.patchRecord(id, { updatedAt: Date.now() })
      return {
        text: options.conversation ? target.text : '',
        ...(options.conversation && target.attachments?.length ? { attachments: target.attachments } : {}),
        ...(options.conversation && target.files?.length ? { files: target.files } : {}),
        ...(files ? { filesRestored: files.length } : {}),
        undoable: !options.code || files !== null,
      }
    } finally {
      ctx.changingSessions.delete(id)
    }
  }

  /** 还原文件；先存一份当前内容（太大时不存，返回空数组表示还原了但不能撤销代码） */
  private async restoreCode(record: SessionRecord, userItemId: string): Promise<UndoEntry['files']> {
    const adapter = this.ctx.adapters[record.engine]
    if (!ENGINES[record.engine].caps.rewindCode || !adapter?.rewindFiles || !record.engineSessionId)
      throw new Error('这条消息没有代码检查点，代码保持不变')
    const preview = await adapter.rewindFiles(record, userItemId, true)
    if (!preview.ok)
      throw new Error(preview.reason === 'no-checkpoint' ? '这条消息没有代码检查点，代码保持不变' : preview.message)
    let size = 0
    const saved: { path: string; data: Buffer | null }[] = []
    for (const path of preview.files) {
      const data = existsSync(path) ? readFileSync(path) : null
      size += data?.length ?? 0
      saved.push({ path, data })
    }
    const done = await adapter.rewindFiles(record, userItemId, false)
    if (!done.ok) throw new Error(done.message || '没能还原代码')
    return size <= UNDO_LIMIT ? saved : null
  }

  /** 截断对话（原来的回退逻辑，docs/ui/chat-fixes-queue-actions-cost.md §2.3） */
  private truncate(id: string, index: number, userItemId: string): void {
    const { ctx } = this
    const m = ctx.m
    const rt = m.sessions.runtime(id)
    const record = rt.snapshot.record
    const dropped = rt.snapshot.items.slice(index).flatMap(item => (item.kind === 'user' ? [item.id] : []))
    const anchor = record.engineSessionId ? ctx.adapters[record.engine]?.rewindAnchor?.(record, dropped) : null
    ctx.store.replaceItems(id, rt.snapshot.items.slice(0, index))
    m.events.apply(id, { type: 'items_truncated', fromItemId: userItemId })
    m.cache.reset(id)
    // Missing native records must never silently preserve the discarded context.
    if (anchor)
      m.events.patchRecord(
        id,
        anchor.at ? { pendingRewind: anchor.at } : { engineSessionId: randomUUID(), pendingRewind: null },
      )
    else {
      m.events.patchRecord(id, { engineSessionId: randomUUID(), pendingRewind: null })
      if (record.engineSessionId)
        m.events.apply(id, {
          type: 'item_completed',
          item: {
            kind: 'notice',
            id: randomUUID(),
            level: 'warn',
            text: '无法在 Claude Code 记录中回退到这条消息，已开始新的引擎会话（之前的上下文没有带过去）',
          },
        })
    }
    if (rt.snapshot.context)
      m.events.apply(id, { type: 'context', context: { ...rt.snapshot.context, stale: true, diagnosticStale: true } })
    if (rt.snapshot.suggestion) m.events.apply(id, { type: 'suggestion', text: null })
  }

  /** 撤销最近一次回退：发了新消息、引擎已经接着跑过、或者重启过就不行 */
  async undoRewind(id: string): Promise<void> {
    const { ctx } = this
    const m = ctx.m
    this.assertIdle(id)
    const entry = this.undo.get(id)
    const snap = m.sessions.runtime(id).snapshot
    if (
      !entry ||
      snap.items.length !== entry.after.count ||
      (snap.items.at(-1)?.id ?? null) !== entry.after.lastId ||
      snap.record.engineSessionId !== entry.after.engineSessionId ||
      (snap.record.pendingRewind ?? null) !== entry.after.pendingRewind
    ) {
      this.undo.delete(id)
      throw new Error('回退之后有了新的对话，不能撤销了')
    }
    ctx.changingSessions.add(id)
    try {
      await this.closeProcess(id)
      for (const file of entry.files ?? []) {
        if (file.data === null) rmSync(file.path, { force: true })
        else {
          mkdirSync(dirname(file.path), { recursive: true })
          writeFileSync(file.path, file.data)
        }
      }
      if (entry.removed.length > 0) {
        // 去掉回退时加的提示，再把移除的条目原样放回
        const extra = snap.items[entry.kept]
        if (extra) {
          ctx.store.replaceItems(id, snap.items.slice(0, entry.kept))
          m.events.apply(id, { type: 'items_truncated', fromItemId: extra.id })
        }
        for (const item of entry.removed) m.events.apply(id, { type: 'item_completed', item })
        m.cache.reset(id)
        m.events.patchRecord(id, { ...entry.before, updatedAt: Date.now() })
      }
      this.undo.delete(id)
    } finally {
      ctx.changingSessions.delete(id)
    }
  }

  /** 从某条用户消息之前分叉出新会话：带上它之前的对话，原会话不变 */
  fork(id: string, userItemId: string, title?: string): ForkResult {
    const { ctx } = this
    const m = ctx.m
    if (ctx.closing) throw new Error('应用正在退出')
    const rt = m.sessions.runtime(id)
    const source = rt.snapshot.record
    if (!ENGINES[source.engine].caps.fork) throw new Error('当前引擎暂不支持分叉')
    const { index, target } = this.userItem(id, userItemId)
    const items = rt.snapshot.items.slice(0, index)
    const later = rt.snapshot.items.slice(index).flatMap(item => (item.kind === 'user' ? [item.id] : []))
    const anchor = source.engineSessionId ? ctx.adapters[source.engine]?.rewindAnchor?.(source, later) : null
    const now = Date.now()
    const record: SessionRecord = {
      ...source,
      id: randomUUID(),
      engineSessionId: randomUUID(),
      title: title ? normalizeSessionTitle(title) : `${source.title}（分支）`,
      titleEdited: true,
      createdAt: now,
      updatedAt: now,
      lastOutcome: null,
      lastError: null,
      archivedAt: null,
      bottomedAt: null,
      pinnedAt: null,
      pendingRewind: null,
      pendingFork: anchor?.at && source.engineSessionId ? { from: source.engineSessionId, at: anchor.at } : null,
      forkedFrom: { sessionId: source.id, title: source.title },
    }
    const notice: Item[] =
      !anchor && source.engineSessionId && items.length > 0
        ? [
            {
              kind: 'notice',
              id: randomUUID(),
              level: 'warn',
              text: '无法在 Claude Code 记录中找到这条消息，分叉出的会话没有带上之前的上下文',
            },
          ]
        : []
    ctx.records.set(record.id, record)
    ctx.store.saveRecord(record)
    ctx.store.replaceItems(record.id, [...items, ...notice])
    m.events.broadcastSessions()
    return {
      record,
      text: target.text,
      ...(target.attachments?.length ? { attachments: target.attachments } : {}),
      ...(target.files?.length ? { files: target.files } : {}),
    }
  }

  /** 旁聊：带着主对话的上下文单独问一次（主任务运行中也可以） */
  async sideQuestion(id: string, question: string, history: SideTurn[]): Promise<string> {
    const { ctx } = this
    const record = ctx.m.sessions.runtime(id).snapshot.record
    const adapter = ctx.adapters[record.engine]
    if (!ENGINES[record.engine].caps.sideChat || !adapter?.sideQuestion) throw new Error('当前引擎暂不支持旁聊')
    if (!record.engineSessionId) throw new Error('先在主对话里发一条消息')
    const text = question.trim()
    if (!text) throw new Error('请输入问题')
    this.sideQuestions.get(id)?.abort()
    const controller = new AbortController()
    this.sideQuestions.set(id, controller)
    try {
      return await adapter.sideQuestion(record, sidePrompt(text, history), controller.signal)
    } finally {
      if (this.sideQuestions.get(id) === controller) this.sideQuestions.delete(id)
    }
  }

  cancelSideQuestion(id: string): void {
    this.sideQuestions.get(id)?.abort()
    this.sideQuestions.delete(id)
  }
}

function displayPath(cwd: string, file: string): string {
  const rel = relative(cwd, file)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.replaceAll('\\', '/') : file
}

/** 旁聊的问题：说明规则，带上前几问，最后是这次的问题 */
export function sidePrompt(question: string, history: SideTurn[]): string {
  const lines = [
    '（旁聊：用户就上面的对话顺便问一个问题。这段问答不会进入主对话。你不能使用任何工具，请直接、简短地回答，用用户提问的语言。）',
  ]
  for (const turn of history.slice(-10)) lines.push('', `问：${turn.question}`, `答：${turn.answer}`)
  lines.push('', `问：${question}`)
  return lines.join('\n')
}
