import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  ACCEPTANCE_MAX,
  MANUAL_TASK_STATUSES,
  type AcceptanceItem,
  type IssueAssignee,
  type IssueLink,
  type ManualTask,
  type TaskSchedule,
} from '../../../shared/types/project-tools'
import { codedError } from '@pixelsky/protocol'
import { JsonStore, value, type ToolsHost } from './common'
import { cleanSchedule } from './schedule'

type Input = Partial<ManualTask>

const LINK_STATES: readonly IssueLink['state'][] = [
  'queued',
  'approval',
  'running',
  'waiting',
  'done',
  'failed',
  'stopped',
]
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('参数不正确')
  return v as Record<string, unknown>
}

/** 负责人：null = 我自己 */
export function cleanAssignee(v: unknown): IssueAssignee | null {
  if (v === null) return null
  const r = record(v)
  return {
    channelId: value(r.channelId, 200, true),
    memberId: value(r.memberId, 200, true),
    name: value(r.name, 80, true),
  }
}

/** 验收标准：去掉空行，最多 20 条 */
export function cleanAcceptance(v: unknown): AcceptanceItem[] {
  if (!Array.isArray(v) || v.length > ACCEPTANCE_MAX) throw new Error('参数不正确')
  return v
    .map(item => ({ text: value(record(item).text, 300), done: record(item).done === true }))
    .filter(item => item.text)
}

/** 派出去的卡片：频道那边写，这里只校验形状 */
export function cleanLink(v: unknown): IssueLink | null {
  if (v === null) return null
  const r = record(v)
  const state = r.state as IssueLink['state']
  if (!LINK_STATES.includes(state) || typeof r.round !== 'number' || typeof r.at !== 'number')
    throw new Error('参数不正确')
  const checks = r.checks == null ? null : record(r.checks)
  if (checks && (!['running', 'pass', 'fail'].includes(checks.status as string) || typeof checks.problems !== 'number'))
    throw new Error('参数不正确')
  return {
    channelId: value(r.channelId, 200, true),
    taskId: value(r.taskId, 200, true),
    state,
    round: r.round,
    checks: checks
      ? { status: checks.status as 'running' | 'pass' | 'fail', problems: checks.problems as number }
      : null,
    error: r.error == null ? null : value(r.error, 300),
    at: r.at,
  }
}
export class Tasks {
  readonly store: JsonStore<{ version: 1; tasks: ManualTask[] }>
  constructor(
    dataDir: string,
    private host: ToolsHost,
    private changed: () => void,
  ) {
    this.store = new JsonStore(join(dataDir, 'tasks.json'), { version: 1, tasks: [] })
  }
  async init(): Promise<void> {
    await this.store.init()
  }
  async state(id: string) {
    this.host.resolve({ projectId: id })
    const plans = await this.host.plans(id)
    return {
      tasks: this.store.data.tasks.filter(t => t.projectId === id).sort((a, b) => a.order - b.order),
      plans,
    }
  }
  private fields(
    input: Input,
    prior?: ManualTask,
  ): Omit<ManualTask, 'id' | 'projectId' | 'order' | 'createdAt' | 'updatedAt' | 'completedAt' | 'pinnedAt'> {
    if (!input || typeof input !== 'object') throw new Error('参数不正确')
    const status = input.status ?? prior?.status ?? 'pending',
      priority = input.priority ?? prior?.priority ?? 'normal'
    if (!MANUAL_TASK_STATUSES.includes(status) || !['low', 'normal', 'high'].includes(priority))
      throw new Error('参数不正确')
    const due = input.due === undefined ? (prior?.due ?? '') : value(input.due, 10)
    if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due)))) throw new Error('日期不正确')
    const tags = input.tags ?? prior?.tags ?? []
    if (!Array.isArray(tags) || tags.length > 12) throw new Error('参数不正确')
    return {
      title: value(input.title ?? prior?.title ?? '', 200, true),
      note: value(input.note ?? prior?.note ?? '', 4000),
      status,
      priority,
      due,
      tags: [...new Set(tags.map(t => value(t, 40, true)))],
      // 事项的字段：没传的沿用原来的（docs/ui/channels-collab-v2.md §9）
      assignee: input.assignee === undefined ? (prior?.assignee ?? null) : cleanAssignee(input.assignee),
      acceptance: input.acceptance === undefined ? (prior?.acceptance ?? []) : cleanAcceptance(input.acceptance),
      link: input.link === undefined ? (prior?.link ?? null) : cleanLink(input.link),
      // 定时设置（docs/ui/board-schedule.md）：没传的沿用；运行记录只由 mutateSchedule 改
      schedule:
        input.schedule === undefined
          ? (prior?.schedule ?? null)
          : cleanSchedule(input.schedule, prior?.schedule, Date.now()),
    }
  }
  async create(projectId: string, input: Input): Promise<ManualTask> {
    this.host.resolve({ projectId })
    const task = await this.store.transaction(data => {
      if (data.tasks.filter(t => t.projectId === projectId).length >= 1000) throw new Error('任务数量已达到上限')
      const now = Date.now(),
        task: ManualTask = {
          ...this.fields(input),
          projectId,
          id: randomUUID(),
          order: data.tasks.length,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        }
      if (task.status === 'completed') task.completedAt = now
      data.tasks.push(task)
      return task
    })
    this.changed()
    return task
  }
  async update(id: string, input: Input): Promise<ManualTask> {
    const result = await this.store.transaction(data => {
      const task = data.tasks.find(t => t.id === id)
      if (!task) throw new Error('任务不存在')
      this.host.resolve({ projectId: task.projectId })
      const next = this.fields(input, task),
        now = Date.now()
      // 完成时间：改成已完成时记下，改回去清掉；本来就是已完成的保持原样
      const completedAt =
        next.status !== 'completed' ? null : task.status === 'completed' ? (task.completedAt ?? null) : now
      Object.assign(task, next, { updatedAt: now, completedAt })
      return task
    })
    this.changed()
    return result
  }
  /**
   * 派出去的卡片变了（频道那边调，docs/ui/channels-collab-v2.md §9）：写上卡片的情况，按卡片改事项状态。
   * 已经验收完成的不再改状态；fresh = 刚派出去的新卡片，其余时候只认事项上记着的那张卡（重新派过以后旧卡的变化不管）
   */
  async syncIssue(id: string, input: { link: unknown; status?: unknown; fresh?: boolean }): Promise<ManualTask | null> {
    const link = cleanLink(record(input).link)
    const status = input.status
    if (status !== undefined && !MANUAL_TASK_STATUSES.includes(status as ManualTask['status']))
      throw new Error('参数不正确')
    const result = await this.store.transaction(data => {
      const task = data.tasks.find(t => t.id === id)
      if (!task || !link) return null
      if (!input.fresh && task.link && task.link.taskId !== link.taskId) return null
      const now = Date.now()
      task.link = link
      task.updatedAt = now
      if (status && task.status !== 'completed' && task.status !== status) task.status = status as ManualTask['status']
      return task
    })
    if (result) this.changed()
    return result
  }
  /** 主进程的定时调度改运行记录、lastSlot（docs/ui/board-schedule.md）；不改 updatedAt。任务没有定时设置时什么也不做 */
  async mutateSchedule(id: string, change: (schedule: TaskSchedule) => void): Promise<void> {
    const touched = await this.store.transaction(data => {
      const schedule = data.tasks.find(t => t.id === id)?.schedule
      if (!schedule) return false
      change(schedule)
      return true
    })
    if (touched) this.changed()
  }
  /** 固定到左侧栏 / 取消固定；不改 updatedAt（固定不算编辑） */
  async pin(id: string, pinned: boolean): Promise<ManualTask> {
    const result = await this.store.transaction(data => {
      const task = data.tasks.find(t => t.id === id)
      if (!task) throw codedError('tasks.notFound')
      // 固定时间严格递增：同一毫秒里连着固定两个时，后固定的仍排在后面
      const latest = Math.max(0, ...data.tasks.map(t => t.pinnedAt ?? 0))
      task.pinnedAt = pinned ? (task.pinnedAt ?? Math.max(Date.now(), latest + 1)) : null
      return task
    })
    this.changed()
    return result
  }
  /** 当前机器所有项目的任务（任务看板用，docs/ui/task-board.md §7）；项目已移除的不列 */
  all(): ManualTask[] {
    return this.store.data.tasks.filter(task => this.known(task.projectId)).sort((a, b) => a.order - b.order)
  }
  private known(projectId: string): boolean {
    try {
      this.host.resolve({ projectId })
      return true
    } catch {
      return false
    }
  }
  /** 所有项目里已固定的任务，按固定时间排；项目已移除的不列 */
  pinned(): ManualTask[] {
    return this.store.data.tasks
      .filter(task => {
        if (!task.pinnedAt) return false
        try {
          this.host.resolve({ projectId: task.projectId })
          return true
        } catch {
          return false
        }
      })
      .sort((a, b) => (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0))
  }
  async remove(id: string): Promise<void> {
    await this.store.transaction(data => {
      data.tasks = data.tasks.filter(t => t.id !== id)
    })
    this.changed()
  }
  async reorder(projectId: string, ids: string[]): Promise<void> {
    this.host.resolve({ projectId })
    await this.store.transaction(data => {
      const tasks = data.tasks.filter(t => t.projectId === projectId)
      if (
        !Array.isArray(ids) ||
        ids.length !== tasks.length ||
        new Set(ids).size !== ids.length ||
        tasks.some(t => !ids.includes(t.id))
      )
        throw new Error('任务列表已变化，请刷新')
      for (const task of tasks) task.order = ids.indexOf(task.id)
    })
    this.changed()
  }
}
