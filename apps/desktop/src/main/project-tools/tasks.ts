import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ManualTask } from '../../preload/project-tools'
import { JsonStore, value, type ToolsHost } from './common'

type Input = Partial<ManualTask>
export class Tasks {
  readonly store: JsonStore<{ version: 1; tasks: ManualTask[] }>
  constructor(dataDir: string, private host: ToolsHost, private changed: () => void) {
    this.store = new JsonStore(join(dataDir, 'tasks.json'), { version: 1, tasks: [] })
  }
  async init(): Promise<void> { await this.store.init() }
  state(id: string) {
    this.host.resolve({ projectId: id })
    return { tasks: this.store.data.tasks.filter(t => t.projectId === id).sort((a, b) => a.order - b.order), plans: this.host.plans(id) }
  }
  private fields(input: Input, prior?: ManualTask): Omit<ManualTask, 'id' | 'projectId' | 'order' | 'createdAt' | 'updatedAt'> {
    if (!input || typeof input !== 'object') throw new Error('参数不正确')
    const status = input.status ?? prior?.status ?? 'pending', priority = input.priority ?? prior?.priority ?? 'normal'
    if (!['pending', 'in_progress', 'completed'].includes(status) || !['low', 'normal', 'high'].includes(priority)) throw new Error('参数不正确')
    const due = input.due === undefined ? prior?.due ?? '' : value(input.due, 10)
    if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due)))) throw new Error('日期不正确')
    const tags = input.tags ?? prior?.tags ?? []
    if (!Array.isArray(tags) || tags.length > 12) throw new Error('参数不正确')
    return { title: value(input.title ?? prior?.title ?? '', 200, true), note: value(input.note ?? prior?.note ?? '', 4000), status, priority, due, tags: [...new Set(tags.map(t => value(t, 40, true)))] }
  }
  async create(projectId: string, input: Input): Promise<ManualTask> {
    this.host.resolve({ projectId })
    const task = await this.store.transaction(data => {
      if (data.tasks.filter(t => t.projectId === projectId).length >= 1000) throw new Error('任务数量已达到上限')
      const now = Date.now(), task: ManualTask = { ...this.fields(input), projectId, id: randomUUID(), order: data.tasks.length, createdAt: now, updatedAt: now }
      data.tasks.push(task); return task
    })
    this.changed(); return task
  }
  async update(id: string, input: Input): Promise<ManualTask> {
    const result = await this.store.transaction(data => {
      const task = data.tasks.find(t => t.id === id); if (!task) throw new Error('任务不存在')
      this.host.resolve({ projectId: task.projectId })
      Object.assign(task, this.fields(input, task), { updatedAt: Date.now() }); return task
    })
    this.changed(); return result
  }
  async remove(id: string): Promise<void> {
    await this.store.transaction(data => { data.tasks = data.tasks.filter(t => t.id !== id) }); this.changed()
  }
  async reorder(projectId: string, ids: string[]): Promise<void> {
    this.host.resolve({ projectId })
    await this.store.transaction(data => {
      const tasks = data.tasks.filter(t => t.projectId === projectId)
      if (!Array.isArray(ids) || ids.length !== tasks.length || new Set(ids).size !== ids.length || tasks.some(t => !ids.includes(t.id))) throw new Error('任务列表已变化，请刷新')
      for (const task of tasks) task.order = ids.indexOf(task.id)
    })
    this.changed()
  }
}
