// 任务看板的手动任务（docs/ui/task-board.md §7）：当前机器所有项目的任务，读一次后跟着主进程的改动通知刷新；
// 有人订阅（看板页、侧栏「任务看板」行）时才读。演示模式用 mock/board.ts，改动只在内存里。
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { tr } from '@/i18n/core'
import { useMachines } from '@/features/machines/store'
import { isDemo } from '@/data'
import { demo } from '@/data/demo'
import { SCHEDULE_RUNS_MAX, type ManualTask } from '../../../../shared/types/project-tools'

interface State {
  tasks: ManualTask[]
  loaded: boolean
  error: string | null
}
let state: State = { tasks: [], loaded: false, error: null }
const listeners = new Set<() => void>()
let stop: (() => void) | null = null
let version = 0

function set(patch: Partial<State>): void {
  state = { ...state, ...patch }
  listeners.forEach(fn => fn())
}

async function load(): Promise<void> {
  const n = ++version
  try {
    const tasks = await window.pixelsky!.projectTools.allTasks()
    if (n === version) set({ tasks, loaded: true, error: null })
  } catch (e) {
    if (n === version) set({ loaded: true, error: (e as Error).message })
  }
}

function start(): void {
  if (isDemo) {
    if (!state.loaded) set({ tasks: demo().boardTasks(Date.now()), loaded: true })
    return
  }
  if (!window.pixelsky) return
  void load()
  // 只是服务多了几行输出时不重取（docs/perf-audit-2026-10-18.md B2）
  stop = window.pixelsky.projectTools.onChange(kind => kind === 'state' && void load())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  if (listeners.size === 1) start()
  return () => {
    listeners.delete(fn)
    if (!listeners.size) {
      stop?.()
      stop = null
    }
  }
}

export function useBoardTasks(): State {
  // 切换机器后重新读（只显示当前机器的项目）
  const machine = useMachines().currentId
  const first = useRef(true)
  useEffect(() => {
    if (first.current) first.current = false
    else if (!isDemo && listeners.size) void load()
  }, [machine])
  return useSyncExternalStore(subscribe, () => state)
}

const demoPatch = (id: string, patch: Partial<ManualTask>): ManualTask => {
  const prior = state.tasks.find(t => t.id === id)
  if (!prior) throw new Error('任务不存在')
  const now = Date.now()
  const completedAt =
    (patch.status ?? prior.status) !== 'completed'
      ? null
      : prior.status === 'completed'
        ? (prior.completedAt ?? null)
        : now
  const next = { ...prior, ...patch, updatedAt: now, completedAt }
  set({ tasks: state.tasks.map(t => (t.id === id ? next : t)) })
  return next
}

/** 马上重读一次（派完事项后：不等主进程的改动通知，免得「交给…」还能再点） */
export async function reloadBoardTasks(): Promise<void> {
  if (!isDemo) await load()
}

export async function updateBoardTask(id: string, patch: Partial<ManualTask>): Promise<void> {
  if (isDemo) {
    demoPatch(id, patch)
    return
  }
  await window.pixelsky!.projectTools.updateTask(id, patch)
  await load()
}

export async function createBoardTask(projectId: string, input: Partial<ManualTask>): Promise<void> {
  if (isDemo) {
    const now = Date.now()
    const task: ManualTask = {
      id: crypto.randomUUID(),
      projectId,
      title: input.title ?? '',
      note: input.note ?? '',
      status: input.status ?? 'pending',
      priority: input.priority ?? 'normal',
      due: input.due ?? '',
      tags: input.tags ?? [],
      order: state.tasks.length,
      createdAt: now,
      updatedAt: now,
      completedAt: input.status === 'completed' ? now : null,
      pinnedAt: null,
      assignee: input.assignee ?? null,
      acceptance: input.acceptance ?? [],
      schedule: input.schedule ?? null,
    }
    set({ tasks: [...state.tasks, task] })
    return
  }
  await window.pixelsky!.projectTools.createTask(projectId, input)
  await load()
}

/** 定时任务立即运行一次；演示模式只在内存里记一条已完成的手动运行 */
export async function runBoardSchedule(id: string): Promise<void> {
  if (isDemo) {
    const schedule = state.tasks.find(t => t.id === id)?.schedule
    if (!schedule) return
    if (schedule.runs.some(r => r.status === 'running')) throw new Error(tr('board.schedule.alreadyRunning'))
    const at = Date.now()
    const run = {
      at,
      trigger: 'manual' as const,
      status: 'done' as const,
      endedAt: at + 180_000,
    }
    demoPatch(id, { schedule: { ...schedule, runs: [run, ...schedule.runs].slice(0, SCHEDULE_RUNS_MAX) } })
    return
  }
  await window.pixelsky!.projectTools.runSchedule(id)
  await load()
}

export async function deleteBoardTask(id: string): Promise<void> {
  if (isDemo) {
    set({ tasks: state.tasks.filter(t => t.id !== id) })
    return
  }
  await window.pixelsky!.projectTools.deleteTask(id)
  await load()
}

/** 演示模式固定 / 取消固定后同步卡片上的图钉（正式模式由主进程的改动通知刷新） */
export function markDemoPinned(id: string, pinned: boolean): void {
  if (isDemo) set({ tasks: state.tasks.map(t => (t.id === id ? { ...t, pinnedAt: pinned ? Date.now() : null } : t)) })
}
