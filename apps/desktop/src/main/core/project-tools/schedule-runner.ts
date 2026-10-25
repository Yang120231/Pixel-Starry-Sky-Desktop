// 定时任务的调度（docs/ui/board-schedule.md §3）：每半分钟扫一遍带定时设置的任务，到点开会话（或派给频道成员）。
// 不导入 electron；会话、频道都经 deps 传入，测试里换成假的
import { randomUUID } from 'node:crypto'
import type { SessionRecord, SessionSummary } from '@pixelsky/protocol'
import { SCHEDULE_GRACE_MS, latestSlot } from '../../../shared/schedule'
import type { ManualTask, ScheduleRun, TaskSchedule } from '../../../shared/types/project-tools'
import { pushRun } from './schedule'

export interface ScheduleDeps {
  tasks: {
    all(): ManualTask[]
    mutateSchedule(id: string, change: (schedule: TaskSchedule) => void): Promise<void>
  }
  /** 引擎操作（和窗口同一层路由）：engine:createSession / engine:renameSession / engine:send */
  call(channel: string, args: unknown[]): Promise<unknown>
  projects(): { id: string }[]
  sessions(): SessionSummary[]
  /** 交给频道成员：channels:dispatchIssue */
  dispatch(channelId: string, issue: unknown): Promise<{ taskId: string }>
  now(): number
  log(message: string, error?: unknown): void
}

/** 刚发出的前几秒里会话可能还没进入「运行」，这段时间不判结束 */
const SETTLE_AFTER_MS = 15_000
export const TICK_MS = 30_000

const firstLine = (text: unknown): string | null => {
  const line = typeof text === 'string' ? text.split('\n')[0].trim().slice(0, 200) : ''
  return line || null
}

/** 会话还在忙：在跑、后台子智能体没完、或有等着发的消息（限流等待恢复时也算，交给「自动继续」） */
export function sessionBusy(s: SessionSummary): boolean {
  if (s.state !== 'idle' && s.state !== 'waiting') return true
  return !!s.background || (!!s.queue && !s.queue.paused && s.queue.queued > 0)
}

export class ScheduleRunner {
  private timer: ReturnType<typeof setInterval> | null = null
  private ticking = false
  private starting = new Set<string>()
  constructor(private deps: ScheduleDeps) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    setTimeout(() => void this.tick(), 5000).unref?.()
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const task of this.deps.tasks.all()) {
        if (!task.schedule) continue
        try {
          await this.settle(task)
          await this.due(task.id)
        } catch (error) {
          this.deps.log('定时任务处理失败', error)
        }
      }
    } finally {
      this.ticking = false
    }
  }

  /** 立即运行：上一次还在跑时报错 */
  async runNow(id: string): Promise<void> {
    const task = this.find(id)
    if (!task?.schedule) throw new Error('任务不存在')
    await this.settle(task)
    if (this.running(this.find(id)!) || this.starting.has(id)) throw new Error('上一次还在运行')
    await this.launch(id, this.deps.now(), 'manual')
  }

  private find = (id: string): ManualTask | undefined => this.deps.tasks.all().find(t => t.id === id)
  private running = (task: ManualTask): boolean => !!task.schedule?.runs.some(r => r.status === 'running')

  private async due(id: string): Promise<void> {
    const task = this.find(id)
    const s = task?.schedule
    if (!task || !s?.enabled) return
    const now = this.deps.now()
    const slot = latestSlot(s, now)
    if (!slot || slot <= s.lastSlot) return
    if (now - slot > SCHEDULE_GRACE_MS) await this.record(id, { at: slot, trigger: 'schedule', status: 'missed' }, slot)
    else if (this.running(task) || this.starting.has(id))
      await this.record(id, { at: slot, trigger: 'schedule', status: 'skipped' }, slot)
    else await this.launch(id, slot, 'schedule')
  }

  private record(id: string, run: ScheduleRun, slot: number | null, sessionId?: string): Promise<void> {
    return this.deps.tasks.mutateSchedule(id, s => {
      s.runs = pushRun(s.runs, run)
      if (slot !== null) s.lastSlot = Math.max(s.lastSlot, slot)
      if (sessionId) s.lastSessionId = sessionId
    })
  }

  private async launch(id: string, at: number, trigger: ScheduleRun['trigger']): Promise<void> {
    const task = this.find(id)
    if (!task?.schedule || this.starting.has(id)) return
    this.starting.add(id)
    const slot = trigger === 'schedule' ? at : null
    try {
      const started = await this.begin(task)
      await this.record(id, { at, trigger, status: 'running', ...started.run }, slot, started.sessionId)
    } catch (error) {
      this.deps.log('定时任务启动失败', error)
      const note = firstLine((error as Error).message) ?? '启动失败'
      await this.record(id, { at, trigger, status: 'failed', endedAt: this.deps.now(), note }, slot)
    } finally {
      this.starting.delete(id)
    }
  }

  /** 开会话发提示词，或派给频道成员；提示词 = 备注（空则用标题），斜杠命令原样发 */
  private async begin(task: ManualTask): Promise<{ run: Partial<ScheduleRun>; sessionId?: string }> {
    const s = task.schedule!
    const prompt = task.note.trim() || task.title
    const member = task.assignee
    if (member) {
      const { taskId } = await this.deps.dispatch(member.channelId, {
        id: task.id,
        title: task.title,
        note: prompt === task.title ? '' : prompt,
        memberId: member.memberId,
        acceptance: [],
      })
      return { run: { card: { channelId: member.channelId, taskId } } }
    }
    if (!this.deps.projects().some(p => p.id === task.projectId)) throw new Error('项目不存在')
    let id = s.session === 'resume' ? s.lastSessionId : null
    if (id && !this.deps.sessions().some(x => x.record.id === id && !x.record.archivedAt)) id = null
    if (!id) {
      const record = (await this.deps.call('engine:createSession', [
        {
          projectId: task.projectId,
          engine: s.engine,
          ...(s.model ? { model: s.model } : {}),
          permissionMode: s.permission,
          rememberChoices: false,
          scheduleTaskId: task.id,
        },
      ])) as SessionRecord
      id = record.id
      await this.deps.call('engine:renameSession', [id, task.title])
    }
    await this.deps.call('engine:send', [id, { text: prompt, clientMessageId: randomUUID() }])
    return { run: { sessionId: id }, sessionId: id }
  }

  /** 正在跑的记录：会话 / 卡片结束了就写上结果 */
  private async settle(task: ManualTask): Promise<void> {
    const runs = task.schedule?.runs.filter(r => r.status === 'running') ?? []
    if (!runs.length) return
    const now = this.deps.now()
    const sessions = this.deps.sessions()
    for (const run of runs) {
      const end = this.ended(task, run, sessions, now)
      if (!end) continue
      await this.deps.tasks.mutateSchedule(task.id, s => {
        const mine = s.runs.find(r => r.at === run.at && r.trigger === run.trigger && r.status === 'running')
        if (mine) Object.assign(mine, end)
      })
    }
  }

  private ended(
    task: ManualTask,
    run: ScheduleRun,
    sessions: SessionSummary[],
    now: number,
  ): Pick<ScheduleRun, 'status' | 'endedAt' | 'note'> | null {
    if (run.card) {
      const link = task.link
      if (!link || link.taskId !== run.card.taskId)
        return now - run.at > SETTLE_AFTER_MS * 4 ? { status: 'done', endedAt: now } : null
      if (link.state === 'done') return { status: 'done', endedAt: link.at }
      if (link.state === 'failed' || link.state === 'stopped')
        return { status: 'failed', endedAt: link.at, note: firstLine(link.error) }
      // 等人处理不算在跑（与会话的 waiting 一致），否则之后每一次都被跳过
      if (link.state === 'approval' || link.state === 'waiting')
        return { status: 'done', endedAt: link.at, note: '等你处理' }
      return null
    }
    if (now - run.at < SETTLE_AFTER_MS) return null
    const summary = sessions.find(x => x.record.id === run.sessionId)
    if (!summary) return { status: 'failed', endedAt: now, note: '会话已被删除' }
    if (sessionBusy(summary)) return null
    const r = summary.record
    const endedAt = Math.max(run.at, r.updatedAt)
    return r.lastOutcome === 'failed'
      ? { status: 'failed', endedAt, note: firstLine(r.lastError) }
      : { status: 'done', endedAt, note: firstLine(r.lastReply) }
  }
}
