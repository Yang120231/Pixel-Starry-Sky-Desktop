// 协作频道 Phase B（docs/ui/channels-phase-b.md）：建频道、加 AI 成员、发消息、@成员派活、跟踪状态、发回结果。
// 不依赖 Electron：引擎调用、推送、机器 / 项目 / 会话列表都由 main/channels/ipc.ts 注入，
// 引擎调用和窗口走同一层路由（含 SSH 机器），所以派到远程会话的活和本机一样。
import { randomUUID } from 'node:crypto'
import type { HostEvent, ProjectRecord, SessionRecord, SessionSummary, OpenedSession } from '@pixelsky/protocol'
import type { Locale } from '../../../shared/i18n/messages'
import type {
  AgentConfig,
  AgentInput,
  AgentMember,
  Channel,
  ChannelInput,
  ChannelMember,
  ChannelMessage,
  ChannelsSnapshot,
  ChannelTask,
  ChannelTaskAction,
  ChannelTextMessage,
  HumanMember,
  PostInput,
} from '../../../shared/types/channels'
import { parseMentions } from '../../../shared/channels/mentions'
import { ChannelStore, type StoredChannel } from './store'
import {
  clipResult,
  continuePrompt,
  decisionOf,
  dispatchPrompt,
  followUpPrompt,
  historyLines,
  summaryOf,
  taskTitle,
} from './prompt'
import {
  clientMessageId,
  diffTotal,
  reconcileRun,
  trackEvent,
  type Finish,
  type TaskRun,
  type Tracked,
} from './tracker'

export const SELF_ID = 'you'
const NAME_MAX = 40
const INSTRUCTIONS_MAX = 2000
const TOPIC_MAX = 200
const PAGE = 200
const DAY = 86_400_000
/** 结束了的运行信息留这么久（重试、追加要求用） */
const KEEP_ENDED = 30 * DAY
const ENGINES = new Set(['claude', 'codex'])

export interface MachineLite {
  id: string
  name: string
  connected: boolean
}

export interface ChannelsDeps {
  store: ChannelStore
  /** 引擎操作表（和窗口同一层路由） */
  call: (channel: string, args: unknown[]) => Promise<unknown>
  emit: (channel: 'channels:changed' | 'channels:message', value: unknown) => void
  machines: () => MachineLite[]
  projects: () => ProjectRecord[]
  sessions: () => SessionSummary[]
  /** 资源 id（项目、会话）属于哪台机器 */
  machineOf: (id: string) => string
  selfName: () => string
  locale: () => Locale
  now?: () => number
  log?: (message: string, error?: unknown) => void
}

const terminal = (status: ChannelTask['status']): boolean =>
  status === 'done' || status === 'failed' || status === 'stopped'
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function cleanName(value: unknown, what: string): string {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!name) throw new Error(`${what}不能为空`)
  if (name.length > NAME_MAX) throw new Error(`${what}最多 ${NAME_MAX} 个字`)
  return name
}

export class Channels {
  private readonly store: ChannelStore
  private readonly now: () => number
  /** clientId → 消息 id：同一条消息重复提交时不重复派活 */
  private readonly posted = new Map<string, string>()
  /** 断开的机器：重连后对账 */
  private offline = new Set<string>()
  private changedTimer: ReturnType<typeof setTimeout> | null = null
  private runsTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: ChannelsDeps) {
    this.store = deps.store
    this.now = deps.now ?? Date.now
  }

  // -------------------------------------------------------------------------
  // 状态
  // -------------------------------------------------------------------------

  self(): HumanMember {
    return { id: SELF_ID, kind: 'human', name: this.deps.selfName(), you: true, role: 'owner' }
  }

  private member(id: string): AgentConfig | undefined {
    return this.store.members.find(m => m.id === id)
  }

  private nameOf = (id: string): string => (id === SELF_ID ? this.deps.selfName() : (this.member(id)?.name ?? '?'))

  private machineOnline(machineId: string): boolean {
    return machineId === 'local' || !!this.deps.machines().find(m => m.id === machineId)?.connected
  }

  private agentView(config: AgentConfig, projects: Map<string, ProjectRecord>, machines: MachineLite[]): AgentMember {
    const now = this.now()
    const runs = [...this.store.runs.values()].filter(r => r.memberId === config.id)
    const tasks = runs.map(r => this.store.task(r.taskId)).filter((t): t is ChannelTask => !!t)
    const active =
      tasks.find(t => t.status === 'waiting') ??
      tasks.find(t => !terminal(t.status) && this.store.runs.get(t.id)?.phase === 'sent')
    const online = this.machineOnline(config.machineId)
    const status = !online
      ? 'offline'
      : tasks.some(t => t.status === 'waiting')
        ? 'waiting'
        : active
          ? 'running'
          : 'idle'
    let total = 0,
      done = 0,
      failed = 0
    let last: AgentMember['last'] = null
    for (const list of this.store.messages.values())
      for (const m of list) {
        if (m.kind !== 'task' || m.assigneeId !== config.id) continue
        if (m.at > now - 30 * DAY) {
          total++
          if (m.status === 'done') done++
          if (m.status === 'failed') failed++
        }
        if (terminal(m.status) && (!last || (m.endedAt ?? m.at) > last.at))
          last = { status: m.status, at: m.endedAt ?? m.at }
      }
    const project = projects.get(config.projectId)
    const shares = this.store.members
      .filter(
        o =>
          o.id !== config.id &&
          o.machineId === config.machineId &&
          o.projectId === config.projectId &&
          o.copyId === config.copyId,
      )
      .map(o => o.name)
    return {
      id: config.id,
      kind: 'agent',
      name: config.name,
      engine: config.engine,
      model: config.settings.model ?? null,
      machineId: config.machineId,
      machine:
        config.machineId === 'local' ? '' : (machines.find(m => m.id === config.machineId)?.name ?? config.machineId),
      project: project?.name ?? null,
      status,
      task: active?.title ?? null,
      sessionId: active?.sessionId ?? null,
      config,
      queued: runs.filter(r => r.phase === 'waiting').length,
      warning: project ? null : '项目不存在',
      last,
      stats: { total, done, failed },
      sharesDirWith: shares,
    }
  }

  private unreadOf(channel: StoredChannel): { unread: number; mentioned: boolean; lastAt: number } {
    let unread = 0,
      mentioned = false,
      lastAt = channel.createdAt
    for (const m of this.store.messages.get(channel.id) ?? []) {
      lastAt = Math.max(lastAt, m.at)
      if (m.kind === 'event' || m.authorId === SELF_ID || m.at <= channel.readAt) continue
      unread++
      if (m.kind === 'message' && m.mentions?.includes(SELF_ID)) mentioned = true
    }
    return { unread, mentioned, lastAt }
  }

  state(): ChannelsSnapshot {
    const projects = new Map(this.deps.projects().map(p => [p.id, p]))
    const machines = this.deps.machines()
    const channels: Channel[] = [...this.store.channels.values()]
      .map(c => ({
        id: c.id,
        name: c.name,
        topic: c.topic,
        project: c.projectId ? (projects.get(c.projectId)?.name ?? null) : null,
        projectId: c.projectId,
        scope: 'local' as const,
        memberIds: c.memberIds,
        createdAt: c.createdAt,
        ...this.unreadOf(c),
      }))
      .sort((a, b) => b.lastAt - a.lastAt)
    const sessionChannels: Record<string, string> = {}
    for (const [channelId, list] of this.store.messages) {
      const name = this.store.channels.get(channelId)?.name
      if (name) for (const m of list) if (m.kind === 'task' && m.sessionId) sessionChannels[m.sessionId] = name
    }
    const members: ChannelMember[] = [
      this.self(),
      ...this.store.members.map(m => this.agentView(m, projects, machines)),
    ]
    return { self: this.self(), channels, members, sessionChannels }
  }

  messages(channelId: string, before?: number | null): { messages: ChannelMessage[]; more: boolean } {
    const list = this.store.messages.get(channelId)
    if (!list) throw new Error('频道不存在')
    const end = before == null ? list.length : list.findIndex(m => m.at >= before)
    const stop = end < 0 ? list.length : end
    const start = Math.max(0, stop - PAGE)
    return { messages: list.slice(start, stop), more: start > 0 }
  }

  private changed(): void {
    if (this.changedTimer) return
    this.changedTimer = setTimeout(() => {
      this.changedTimer = null
      this.deps.emit('channels:changed', this.state())
    }, 30)
  }

  private pushMessage(m: ChannelMessage): void {
    this.deps.emit('channels:message', { channelId: m.channelId, message: m })
  }

  /** 运行信息里的回复、改动随事件频繁变化，攒一下再写 */
  private saveRuns(soon = false): void {
    if (soon) {
      if (this.runsTimer) return
      this.runsTimer = setTimeout(() => {
        this.runsTimer = null
        void this.store.saveRuns().catch(e => this.deps.log?.('保存频道任务失败', e))
      }, 2000)
      return
    }
    if (this.runsTimer) clearTimeout(this.runsTimer)
    this.runsTimer = null
    void this.store.saveRuns().catch(e => this.deps.log?.('保存频道任务失败', e))
  }

  /** 退出前：把攒着的运行信息写盘，等写完 */
  async dispose(): Promise<void> {
    if (this.changedTimer) clearTimeout(this.changedTimer)
    this.changedTimer = null
    if (this.runsTimer) this.saveRuns()
    await this.store.flush()
  }

  // -------------------------------------------------------------------------
  // 频道
  // -------------------------------------------------------------------------

  private channel(id: string): StoredChannel {
    const c = this.store.channels.get(id)
    if (!c) throw new Error('频道不存在')
    return c
  }

  private uniqueChannelName(name: string, except?: string): void {
    for (const c of this.store.channels.values())
      if (c.id !== except && c.name.toLowerCase() === name.toLowerCase()) throw new Error('已经有同名的频道')
  }

  private event(
    channelId: string,
    event: Extract<ChannelMessage, { kind: 'event' }>['event'],
    extra: { targetId?: string; value?: string } = {},
  ): void {
    const m: ChannelMessage = {
      kind: 'event',
      id: randomUUID(),
      channelId,
      at: this.now(),
      event,
      actorId: SELF_ID,
      ...extra,
    }
    void this.store.append(m).catch(e => this.deps.log?.('保存频道消息失败', e))
    this.pushMessage(m)
  }

  async create(raw: ChannelInput): Promise<string> {
    const name = cleanName(raw?.name, '频道名')
    this.uniqueChannelName(name)
    const agents = (Array.isArray(raw.memberIds) ? raw.memberIds : []).filter(id => this.member(id))
    const now = this.now()
    const channel: StoredChannel = {
      id: randomUUID(),
      name,
      topic: typeof raw.topic === 'string' && raw.topic.trim() ? raw.topic.trim().slice(0, TOPIC_MAX) : null,
      projectId: typeof raw.projectId === 'string' && raw.projectId ? raw.projectId : null,
      memberIds: [SELF_ID, ...new Set(agents)],
      createdAt: now,
      readAt: now,
    }
    await this.store.saveChannel(channel)
    for (const id of new Set(agents)) this.event(channel.id, 'added', { targetId: id })
    this.changed()
    return channel.id
  }

  async update(id: string, patch: { name?: string; topic?: string | null; projectId?: string | null }): Promise<void> {
    const c = { ...this.channel(id) }
    if (patch.name !== undefined) {
      const name = cleanName(patch.name, '频道名')
      if (name !== c.name) {
        this.uniqueChannelName(name, id)
        c.name = name
        this.event(id, 'renamed', { value: name })
      }
    }
    if (patch.topic !== undefined) {
      const topic =
        typeof patch.topic === 'string' && patch.topic.trim() ? patch.topic.trim().slice(0, TOPIC_MAX) : null
      if (topic !== c.topic) {
        c.topic = topic
        this.event(id, 'topic', { value: topic ?? '' })
      }
    }
    if (patch.projectId !== undefined)
      c.projectId = typeof patch.projectId === 'string' && patch.projectId ? patch.projectId : null
    await this.store.saveChannel(c)
    this.changed()
  }

  /** 删除频道：消息没了，开出来的会话保留；进行中的活照常做完，不再跟踪 */
  async delete(id: string): Promise<void> {
    this.channel(id)
    const members = new Set([...this.store.runs.values()].filter(r => r.channelId === id).map(r => r.memberId))
    await this.store.deleteChannel(id)
    this.saveRuns()
    for (const m of members) void this.pump(m)
    this.changed()
  }

  markRead(id: string): void {
    const c = this.store.channels.get(id)
    if (!c) return
    const last = (this.store.messages.get(id) ?? []).reduce((max, m) => Math.max(max, m.at), 0)
    if (c.readAt >= last) return
    void this.store
      .saveChannel({ ...c, readAt: Math.max(this.now(), last) })
      .catch(e => this.deps.log?.('保存频道失败', e))
    this.changed()
  }

  // -------------------------------------------------------------------------
  // 成员
  // -------------------------------------------------------------------------

  /** 新建或编辑 AI 成员；带 channelId 时顺便加进这个频道 */
  async saveMember(channelId: string | null, raw: AgentInput): Promise<string> {
    const name = cleanName(raw?.name, '成员名')
    if (!ENGINES.has(raw.engine)) throw new Error('不支持的引擎')
    if (typeof raw.projectId !== 'string' || !raw.projectId) throw new Error('请选择工作目录')
    if (this.store.members.some(m => m.id !== raw.id && m.name.toLowerCase() === name.toLowerCase()))
      throw new Error('已经有同名的 AI 成员')
    const project = this.deps.projects().find(p => p.id === raw.projectId)
    if (!project) throw new Error('项目不存在')
    const existing = raw.id ? this.member(raw.id) : undefined
    if (raw.id && !existing) throw new Error('成员不存在')
    const settings: AgentConfig['settings'] = {}
    if (raw.settings?.model !== undefined) settings.model = raw.settings.model
    if (raw.settings?.effort !== undefined) settings.effort = raw.settings.effort
    if (raw.settings?.permissionMode !== undefined) settings.permissionMode = raw.settings.permissionMode
    const machineId = this.deps.machineOf(raw.projectId)
    const moved =
      existing &&
      (existing.engine !== raw.engine ||
        existing.projectId !== raw.projectId ||
        existing.copyId !== (raw.copyId ?? null))
    const config: AgentConfig = {
      id: existing?.id ?? randomUUID(),
      name,
      engine: raw.engine,
      machineId,
      projectId: raw.projectId,
      copyId: raw.copyId ?? null,
      settings,
      instructions: (typeof raw.instructions === 'string' ? raw.instructions : '').slice(0, INSTRUCTIONS_MAX),
      mode: raw.mode === 'shared' ? 'shared' : 'per-task',
      // 换了引擎或目录，原来的共用会话不能再用
      sharedSessionId: moved ? null : (existing?.sharedSessionId ?? null),
      createdAt: existing?.createdAt ?? this.now(),
    }
    this.store.members = existing
      ? this.store.members.map(m => (m.id === config.id ? config : m))
      : [...this.store.members, config]
    await this.store.saveMembers()
    if (channelId) await this.addMember(channelId, config.id)
    this.changed()
    return config.id
  }

  async addMember(channelId: string, memberId: string): Promise<void> {
    const c = this.channel(channelId)
    if (!this.member(memberId)) throw new Error('成员不存在')
    if (c.memberIds.includes(memberId)) return
    await this.store.saveChannel({ ...c, memberIds: [...c.memberIds, memberId] })
    this.event(channelId, 'added', { targetId: memberId })
    this.changed()
  }

  /** 从频道移除：已经发出去的活照常做完、结果照常发回；还在排队的取消 */
  async removeMember(channelId: string, memberId: string): Promise<void> {
    const c = this.channel(channelId)
    if (!c.memberIds.includes(memberId) || memberId === SELF_ID) return
    await this.store.saveChannel({ ...c, memberIds: c.memberIds.filter(id => id !== memberId) })
    for (const run of [...this.store.runs.values()])
      if (run.channelId === channelId && run.memberId === memberId && run.phase === 'waiting')
        this.finish(run, { status: 'stopped', note: 'cancelled' })
    this.event(channelId, 'removed', { targetId: memberId })
    this.changed()
  }

  /** 全局删除成员：有没做完的活时不让删 */
  async deleteMember(memberId: string): Promise<void> {
    if (!this.member(memberId)) return
    if ([...this.store.runs.values()].some(r => r.memberId === memberId && r.phase !== 'ended'))
      throw new Error('这个成员还有没做完的活')
    this.store.members = this.store.members.filter(m => m.id !== memberId)
    await this.store.saveMembers()
    for (const c of this.store.channels.values())
      if (c.memberIds.includes(memberId))
        await this.store.saveChannel({ ...c, memberIds: c.memberIds.filter(id => id !== memberId) })
    for (const [id, run] of this.store.runs) if (run.memberId === memberId) this.store.runs.delete(id)
    this.saveRuns()
    this.changed()
  }

  // -------------------------------------------------------------------------
  // 发消息、派活
  // -------------------------------------------------------------------------

  private channelMembers(c: StoredChannel): { id: string; name: string }[] {
    return c.memberIds.map(id => ({ id, name: this.nameOf(id) }))
  }

  /** 引用的是任务卡或任务结果：对应的任务卡 */
  private replyTask(channelId: string, replyToId: string | null | undefined): ChannelTask | null {
    if (!replyToId) return null
    const target = this.store.messages.get(channelId)?.find(m => m.id === replyToId)
    if (target?.kind === 'task') return target
    if (target?.kind === 'message' && target.taskId) {
      const task = this.store.task(target.taskId)
      return task?.channelId === channelId ? task : null
    }
    return null
  }

  async post(channelId: string, input: PostInput): Promise<{ message: ChannelTextMessage; tasks: string[] }> {
    const c = this.channel(channelId)
    const text = typeof input?.text === 'string' ? input.text.trim() : ''
    if (!text) throw new Error('消息不能为空')
    const clientId = typeof input.clientId === 'string' ? input.clientId : randomUUID()
    const known = this.posted.get(clientId)
    if (known) {
      const m = this.store.messages.get(channelId)?.find(x => x.id === known)
      if (m?.kind === 'message') return { message: m, tasks: [] }
    }
    const members = this.channelMembers(c)
    const replyToId =
      input.replyToId && this.store.messages.get(channelId)?.some(m => m.id === input.replyToId)
        ? input.replyToId
        : null
    const now = this.now()
    const message: ChannelTextMessage = {
      kind: 'message',
      id: randomUUID(),
      channelId,
      at: now,
      authorId: SELF_ID,
      text,
      format: 'plain',
      replyToId,
      mentions: parseMentions(text, members).filter(id => id !== SELF_ID),
    }
    this.posted.set(clientId, message.id)
    await this.store.append(message)
    // 发消息就算看过了
    await this.store.saveChannel({ ...c, readAt: now })
    this.pushMessage(message)
    const agents = (message.mentions ?? []).filter(id => this.member(id))
    const target = this.replyTask(channelId, replyToId)
    const tasks: string[] = []
    if (target && agents.every(id => id === target.assigneeId)) {
      this.followUp(c, target, message)
      tasks.push(target.id)
    } else for (const id of agents) tasks.push(this.newTask(c, message, id, replyToId))
    this.changed()
    return { message, tasks }
  }

  /** 第一次派给成员的提示词：带最近的讨论和被引用的消息 */
  private freshPrompt(
    c: StoredChannel,
    source: ChannelTextMessage,
    member: AgentConfig,
    replyToId: string | null,
    shared: boolean,
  ): string {
    const list = this.store.messages.get(c.id) ?? []
    const locale = this.deps.locale()
    // 一直用同一个会话：只补上次派给它之后的消息
    let since: number | null = null
    if (shared && member.sharedSessionId)
      for (const m of list)
        if (
          m.kind === 'task' &&
          m.assigneeId === member.id &&
          m.at < source.at &&
          m.sessionId === member.sharedSessionId
        )
          since = m.at
    const quoted = replyToId ? list.find(m => m.id === replyToId) : undefined
    const quotedText =
      quoted?.kind === 'message'
        ? `${this.nameOf(quoted.authorId)}${locale === 'en-US' ? ': ' : '：'}${quoted.text}`
        : quoted?.kind === 'task'
          ? quoted.title
          : null
    return dispatchPrompt({
      locale,
      channel: { name: c.name, topic: c.topic },
      author: this.nameOf(SELF_ID),
      instructions: member.instructions,
      history: historyLines(list, { beforeId: source.id, since, skip: replyToId, nameOf: this.nameOf, locale }),
      quoted: quotedText,
      request: source.text,
    })
  }

  private newTask(c: StoredChannel, source: ChannelTextMessage, memberId: string, replyToId: string | null): string {
    const member = this.member(memberId)!
    const now = this.now()
    const task: ChannelTask = {
      kind: 'task',
      id: randomUUID(),
      channelId: c.id,
      at: now,
      authorId: SELF_ID,
      assigneeId: memberId,
      title: taskTitle(source.text, this.channelMembers(c)) || source.text.slice(0, 60),
      status: 'queued',
      sessionId: null,
      sourceMessageId: source.id,
      round: 1,
    }
    void this.store.append(task).catch(e => this.deps.log?.('保存频道消息失败', e))
    this.pushMessage(task)
    const prompt = this.freshPrompt(c, source, member, replyToId, member.mode === 'shared')
    const run: TaskRun = {
      taskId: task.id,
      channelId: c.id,
      memberId,
      phase: 'waiting',
      queuedAt: now,
      round: 1,
      sessionId: null,
      clientMessageId: null,
      prompt,
      // 共用会话被删了、要新开时，带完整的讨论
      freshPrompt: member.mode === 'shared' ? this.freshPrompt(c, source, member, replyToId, false) : prompt,
      started: false,
      turnId: null,
      requests: [],
      diff: {},
      reply: null,
      progress: null,
      followUps: [],
      notice: null,
    }
    this.store.runs.set(task.id, run)
    this.saveRuns()
    void this.pump(memberId)
    return task.id
  }

  /** 回复任务卡 = 追加要求（§7.1）：还在做时等这一轮做完再发 */
  private followUp(c: StoredChannel, task: ChannelTask, source: ChannelTextMessage): void {
    const member = this.member(task.assigneeId)
    if (!member) return
    const locale = this.deps.locale()
    const text = followUpPrompt({ locale, channel: c.name, author: this.nameOf(SELF_ID), text: source.text })
    const run = this.store.runs.get(task.id)
    if (run && run.phase !== 'ended') {
      this.store.runs.set(task.id, { ...run, followUps: [...run.followUps, text] })
      this.saveRuns()
      return
    }
    this.nextRound(task, run ?? null, text, this.freshPrompt(c, source, member, task.id, false))
  }

  /** 开始下一轮（追加要求、重试）：排进成员的队列 */
  private nextRound(task: ChannelTask, run: TaskRun | null, prompt: string, fresh: string): void {
    const round = (task.round ?? 1) + 1
    const next: TaskRun = {
      taskId: task.id,
      channelId: task.channelId,
      memberId: task.assigneeId,
      phase: 'waiting',
      queuedAt: this.now(),
      round,
      sessionId: run?.sessionId ?? task.sessionId ?? null,
      clientMessageId: null,
      prompt,
      freshPrompt: fresh,
      started: false,
      turnId: null,
      requests: [],
      diff: {},
      reply: null,
      progress: null,
      followUps: [],
      notice: null,
    }
    this.store.runs.set(task.id, next)
    this.patch(task.channelId, task.id, {
      status: 'queued',
      round,
      error: null,
      note: null,
      decision: null,
      request: null,
      progress: null,
      endedAt: null,
    })
    this.saveRuns()
    void this.pump(task.assigneeId)
  }

  private patch(channelId: string, taskId: string, patch: Partial<ChannelTask>): ChannelTask | null {
    const task = this.store.patchTask(channelId, taskId, patch)
    if (task) this.pushMessage(task)
    return task
  }

  /** 成员空出来了就开始它最早排队的那项活；还在忙就更新排队的「前面还有 N 项」 */
  private async pump(memberId: string): Promise<void> {
    const runs = [...this.store.runs.values()].filter(r => r.memberId === memberId)
    const busy = runs.some(r => r.phase === 'sent')
    const waiting = runs.filter(r => r.phase === 'waiting').sort((a, b) => a.queuedAt - b.queuedAt)
    waiting.forEach((r, i) => {
      const ahead = i + (busy ? 1 : 0)
      if (this.store.task(r.taskId)?.ahead !== ahead) this.patch(r.channelId, r.taskId, { ahead })
    })
    this.changed()
    if (busy || !waiting.length) return
    await this.start(waiting[0])
  }

  private sessionExists(id: string | null | undefined): boolean {
    return !!id && this.deps.sessions().some(s => s.record.id === id)
  }

  private async start(run: TaskRun): Promise<void> {
    const member = this.member(run.memberId)
    const task = this.store.task(run.taskId)
    if (!member || !task || !this.store.channels.has(run.channelId)) {
      this.store.runs.delete(run.taskId)
      this.saveRuns()
      return
    }
    // 先占住成员，免得同时开始两项
    const cmid = clientMessageId(task.id, run.round)
    let current: TaskRun = { ...run, phase: 'sent', clientMessageId: cmid }
    this.store.runs.set(run.taskId, current)
    this.patch(run.channelId, run.taskId, { ahead: 0, disconnected: false })
    try {
      if (!this.machineOnline(member.machineId)) {
        const name = this.deps.machines().find(m => m.id === member.machineId)?.name ?? member.machineId
        throw new Error(`机器「${name}」未连接`)
      }
      let sessionId = current.sessionId
      let text = current.prompt
      if (!this.sessionExists(sessionId)) {
        sessionId =
          member.mode === 'shared' && this.sessionExists(member.sharedSessionId) ? member.sharedSessionId : null
        if (!sessionId) {
          sessionId = await this.createSession(member, task.title)
          text = current.freshPrompt
        } else if (current.round > 1) text = current.freshPrompt
      }
      current = { ...current, sessionId }
      this.store.runs.set(run.taskId, current)
      this.patch(run.channelId, run.taskId, { sessionId, status: 'queued' })
      this.saveRuns()
      await this.deps.call('engine:send', [sessionId, { text, clientMessageId: cmid }])
    } catch (error) {
      const latest = this.store.runs.get(run.taskId)
      if (latest && latest.phase === 'sent' && !latest.started)
        this.finish(latest, { status: 'failed', error: message(error) })
    }
  }

  private async createSession(member: AgentConfig, title: string): Promise<string> {
    const record = (await this.deps.call('engine:createSession', [
      {
        projectId: member.projectId,
        engine: member.engine,
        ...member.settings,
        ...(member.copyId ? { copyId: member.copyId } : {}),
      },
    ])) as SessionRecord
    const shared = member.mode === 'shared'
    // 侧栏里认得出来：会话标题用任务标题（共用会话用成员名）
    await this.deps
      .call('engine:renameSession', [record.id, shared ? member.name : title])
      .catch(e => this.deps.log?.('频道会话改名失败', e))
    if (shared) {
      this.store.members = this.store.members.map(m => (m.id === member.id ? { ...m, sharedSessionId: record.id } : m))
      await this.store.saveMembers()
    }
    return record.id
  }

  /** 这一轮结束：更新任务卡，做完了就把回复发回频道，再开始成员的下一项活 */
  private finish(run: TaskRun, finish: Finish): void {
    const task = this.store.task(run.taskId)
    const ended: TaskRun = { ...run, phase: 'ended', requests: [], progress: null }
    this.store.runs.set(run.taskId, ended)
    if (task) {
      const now = this.now()
      const patch: Partial<ChannelTask> = {
        status: finish.status,
        error: finish.status === 'failed' ? (finish.error ?? null) : null,
        note: finish.note ?? null,
        request: null,
        progress: null,
        ahead: 0,
        disconnected: false,
        endedAt: now,
      }
      if (finish.status === 'done' || run.reply) {
        const diff = diffTotal(run)
        if (diff) patch.diff = diff
      }
      if (finish.status === 'done') {
        const reply = run.reply?.trim() ?? ''
        const locale = this.deps.locale()
        patch.summary = reply ? summaryOf(reply) : locale === 'en-US' ? 'No reply text' : '没有回复文字'
        patch.decision = reply ? decisionOf(reply) : null
        if (reply) {
          const result: ChannelTextMessage = {
            kind: 'message',
            id: randomUUID(),
            channelId: run.channelId,
            at: now,
            authorId: run.memberId,
            text: clipResult(reply, locale),
            format: 'markdown',
            replyToId: task.id,
            taskId: task.id,
            mentions: patch.decision ? [SELF_ID] : [],
          }
          if (this.store.channels.has(run.channelId)) {
            void this.store.append(result).catch(e => this.deps.log?.('保存频道消息失败', e))
            this.pushMessage(result)
          }
        }
      }
      this.patch(run.channelId, run.taskId, patch)
      // 做的时候追加的要求：接着发
      if (run.followUps.length && finish.note !== 'cancelled') {
        const text = run.followUps.join('\n\n')
        this.nextRound({ ...task, ...patch } as ChannelTask, ended, text, text)
        return
      }
    }
    this.saveRuns()
    this.prune()
    void this.pump(run.memberId)
  }

  /** 去掉很久以前结束的运行信息 */
  private prune(): void {
    const cutoff = this.now() - KEEP_ENDED
    for (const [id, run] of this.store.runs) {
      if (run.phase !== 'ended') continue
      const task = this.store.task(id)
      if (!task || (task.endedAt ?? task.at) < cutoff) this.store.runs.delete(id)
    }
  }

  private apply(run: TaskRun, tracked: Tracked): void {
    if (tracked.run !== run) {
      this.store.runs.set(run.taskId, tracked.run)
      this.saveRuns(!tracked.finish && tracked.run.started === run.started)
    }
    if (tracked.patch) this.patch(run.channelId, run.taskId, tracked.patch)
    if (tracked.finish) this.finish(tracked.run, tracked.finish)
    else if (tracked.patch?.status) this.changed()
  }

  // -------------------------------------------------------------------------
  // 卡片上的操作
  // -------------------------------------------------------------------------

  async taskAction(taskId: string, action: ChannelTaskAction): Promise<void> {
    const task = this.store.task(taskId)
    if (!task) throw new Error('任务不存在')
    const run = this.store.runs.get(taskId)
    if (action === 'retry') {
      if (!terminal(task.status)) return
      if (!this.member(task.assigneeId)) throw new Error('成员不存在')
      const c = this.channel(task.channelId)
      const source = this.store.messages.get(c.id)?.find(m => m.id === task.sourceMessageId)
      const fresh =
        source?.kind === 'message'
          ? this.freshPrompt(c, source, this.member(task.assigneeId)!, source.replyToId ?? null, false)
          : (run?.freshPrompt ?? task.title)
      // 还没开始就失败：原样再发一次；做到一半：发「继续」
      const prompt = run?.started ? continuePrompt(this.deps.locale()) : (run?.prompt ?? fresh)
      this.nextRound(task, run ?? null, prompt, fresh)
      return
    }
    if (!run || run.phase === 'ended') return
    if (run.phase === 'waiting') {
      this.finish(run, { status: 'stopped', note: 'cancelled' })
      return
    }
    if (action === 'stop' && run.started && run.sessionId && run.turnId) {
      await this.deps.call('engine:interruptTurn', [run.sessionId, run.turnId])
      return
    }
    if (!run.started && run.sessionId && run.clientMessageId) {
      await this.deps.call('engine:cancelQueued', [run.sessionId, run.clientMessageId]).catch(() => undefined)
      const latest = this.store.runs.get(taskId)
      if (latest?.phase === 'sent' && !latest.started) this.finish(latest, { status: 'stopped', note: 'cancelled' })
    }
  }

  // -------------------------------------------------------------------------
  // 会话事件、对账
  // -------------------------------------------------------------------------

  hostEvent(event: HostEvent): void {
    if (event.kind === 'session') {
      for (const run of [...this.store.runs.values()])
        if (run.phase === 'sent' && run.sessionId === event.sessionId) this.apply(run, trackEvent(run, event.event))
    } else if (event.kind === 'sessions') this.sessionsChanged(event.sessions)
    else if (event.kind === 'projects') this.changed()
  }

  /** 会话被删了：进行中的活算失败（只看连着的机器，断开的机器会话列表不可信） */
  private sessionsChanged(sessions: SessionSummary[]): void {
    const ids = new Set(sessions.map(s => s.record.id))
    for (const run of [...this.store.runs.values()]) {
      if (run.phase !== 'sent' || !run.sessionId || ids.has(run.sessionId)) continue
      const member = this.member(run.memberId)
      if (member && this.machineOnline(member.machineId)) this.finish(run, { status: 'failed', error: '会话已删除' })
    }
  }

  /** 机器连上 / 断开（machines:changed） */
  machinesChanged(): void {
    const machines = this.deps.machines()
    const down = new Set(machines.filter(m => m.id !== 'local' && !m.connected).map(m => m.id))
    const up = [...this.offline].filter(id => !down.has(id))
    this.offline = down
    for (const run of this.store.runs.values()) {
      if (run.phase !== 'sent') continue
      const member = this.member(run.memberId)
      if (member && down.has(member.machineId) && !this.store.task(run.taskId)?.disconnected)
        this.patch(run.channelId, run.taskId, { disconnected: true })
    }
    if (up.length) void this.reconcile(id => up.includes(id))
    this.changed()
  }

  /** 按会话快照对账（启动时全部，重连时那台机器的） */
  async reconcile(machine: (id: string) => boolean = () => true): Promise<void> {
    for (const run of [...this.store.runs.values()]) {
      const member = this.member(run.memberId)
      if (!member || !machine(member.machineId)) continue
      if (run.phase === 'waiting') continue
      if (run.phase !== 'sent' || !run.sessionId) continue
      if (!this.machineOnline(member.machineId)) {
        this.patch(run.channelId, run.taskId, { disconnected: true })
        continue
      }
      let snapshot: OpenedSession['snapshot'] | null = null
      try {
        snapshot = ((await this.deps.call('engine:openSession', [run.sessionId])) as OpenedSession).snapshot
      } catch (error) {
        if (!/不存在|not found/i.test(message(error))) {
          this.deps.log?.('频道任务对账失败', error)
          continue
        }
      }
      const latest = this.store.runs.get(run.taskId)
      if (!latest || latest.phase !== 'sent') continue
      this.patch(run.channelId, run.taskId, { disconnected: false })
      this.apply(latest, reconcileRun(latest, snapshot))
    }
    for (const m of new Set([...this.store.runs.values()].filter(r => r.phase === 'waiting').map(r => r.memberId)))
      void this.pump(m)
  }
}
