// 「任务」的数据和运行（docs/ui/coding-tasks.md §3、§4）：读任务列表（按工作区缓存）、任务 → 终端的内存对应、跑 / 停 / 跳到终端
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { RunTask, RunTaskGroup, RunTaskState } from '../../../../../shared/types/project-tools'
import type { WorkspaceRef } from '../../../../../shared/types/workspace'
import { isDemo } from '@/data'
import { demo } from '@/data/demo'
import { FILE_SAVED_EVENT } from '@/features/files/store'
import { terminalState, useTerminalStore } from '@/features/terminal/store'
import { useTerminalUi } from '@/features/terminal/TerminalProvider'
import { IDLE, isTaskFile, taskCommand, taskKey, taskStatus, type TaskStatus } from './model'

/** 视图重新显示时，距上次读取超过这么久才重新读 */
export const TASKS_STALE_MS = 10_000

export interface TasksEntry {
  state: RunTaskState | null
  loading: boolean
  error: string | null
  /** 上次读成功的时间 */
  at: number
}
const EMPTY: TasksEntry = { state: null, loading: false, error: null, at: 0 }
const refKey = (ref: WorkspaceRef): string => JSON.stringify(ref)

// ---- 任务列表：按工作区缓存 ----
const entries = new Map<string, TasksEntry>()
const refs = new Map<string, WorkspaceRef>()
const listeners = new Set<() => void>()
const notify = (): void => listeners.forEach(fn => fn())
const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
function patch(key: string, next: Partial<TasksEntry>): void {
  entries.set(key, { ...(entries.get(key) ?? EMPTY), ...next })
  notify()
}

/** 读任务；maxAge 内读过就不再读（0 = 总是读）。同一工作区同时只读一次 */
export async function loadTasks(ref: WorkspaceRef, maxAge = 0): Promise<void> {
  const key = refKey(ref)
  const current = entries.get(key)
  if (current?.loading) return
  if (current?.state && maxAge > 0 && Date.now() - current.at < maxAge) return
  refs.set(key, ref)
  if (isDemo) {
    patch(key, { state: demo().projectTools.runTasks, loading: false, error: null, at: Date.now() })
    return
  }
  patch(key, { loading: true, error: null })
  try {
    const state = await window.pixelsky!.projectTools.runTasks(ref)
    patch(key, { state, loading: false, error: null, at: Date.now() })
  } catch (cause) {
    patch(key, { loading: false, error: cause instanceof Error ? cause.message : String(cause) })
  }
}

/** 这个工作区的任务列表（不自动读；调用 loadTasks） */
export function useRunTasks(ref: WorkspaceRef | null): TasksEntry {
  const key = ref ? refKey(ref) : ''
  return useSyncExternalStore(subscribe, () => entries.get(key) ?? EMPTY)
}
/** 不在 React 里取当前缓存（编辑器 ▶ 用） */
export const getRunTasks = (ref: WorkspaceRef | null): TasksEntry => (ref ? (entries.get(refKey(ref)) ?? EMPTY) : EMPTY)

const normRoot = (root: string): string => root.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
// 编辑器保存了 package.json / Makefile / Cargo.toml：根目录相同的缓存重新读
if (typeof window !== 'undefined')
  window.addEventListener(FILE_SAVED_EVENT, event => {
    const { root, path } = (event as CustomEvent<{ root: string; path: string }>).detail
    if (!isTaskFile(path)) return
    for (const [key, entry] of entries)
      if (entry.state && normRoot(entry.state.root) === normRoot(root) && refs.has(key)) void loadTasks(refs.get(key)!)
  })

// ---- 任务 → 终端（只在内存里，本次打开软件以来） ----
interface Run {
  terminalId: string
  /** 发过 Ctrl+C：行显示「已停止」，终端还在 */
  stopped: boolean
  /** 演示模式：不开真终端，直接算成功 */
  demoOk: boolean
}
const runs = new Map<string, Run>()
/** runs 每变一次加一，给 useSyncExternalStore 当快照 */
let runVersion = 0
const runKey = (root: string, group: RunTaskGroup, task: RunTask): string =>
  `${normRoot(root)}\u0001${taskKey(group, task)}`
function setRun(key: string, run: Run | null): void {
  if (run) runs.set(key, run)
  else runs.delete(key)
  runVersion++
  notify()
}

/** 任务状态：终端被关掉就回到平时的样子 */
function statusOf(key: string): TaskStatus {
  const run = runs.get(key)
  if (!run) return IDLE
  const record = terminalState().terminals.find(r => r.id === run.terminalId)
  if (!record) return IDLE
  if (run.demoOk) return { kind: 'ok', code: null }
  return taskStatus(record, run.stopped)
}

export interface TaskStatuses {
  /** 一个任务现在的状态 */
  of(group: RunTaskGroup, task: RunTask): TaskStatus
  /** 在跑的任务个数（工具条角标） */
  running: number
}
/** 当前工作区所有任务的状态；终端记录变化或任务对应变化时更新 */
export function useTaskStatuses(state: RunTaskState | null): TaskStatuses {
  const terminals = useTerminalStore().terminals
  const version = useSyncExternalStore(subscribe, () => runVersion)
  return useMemo(() => {
    const root = state?.root ?? ''
    let running = 0
    if (state)
      for (const group of state.groups)
        for (const task of group.tasks) if (statusOf(runKey(root, group, task)).kind === 'running') running++
    return { of: (group, task) => statusOf(runKey(root, group, task)), running }
    // runs 是模块里的 Map，terminals / version 只用来触发重新计算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, terminals, version])
}
/**
 * 重启软件后任务和终端的对应没了：找一个这个工作区里同名、没在跑、也没被别的任务占着的终端接着用，
 * 免得每次重启后再跑都多开一个同名终端
 */
function idleTerminalNamed(name: string, root: string): string | null {
  const taken = new Set([...runs.values()].map(r => r.terminalId))
  const norm = (p: string) => p.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  return (
    terminalState().terminals.find(
      r =>
        r.title === name &&
        !taken.has(r.id) &&
        r.status !== 'running' &&
        r.status !== 'starting' &&
        norm(r.cwd) === norm(root),
    )?.id ?? null
  )
}
export interface TaskRunner {
  /** 运行：还在跑就只跳到它的终端；fresh = 总是新开终端 */
  run(group: RunTaskGroup, task: RunTask, fresh?: boolean): Promise<void>
  /** 往它的终端发 Ctrl+C，行标成已停止 */
  stop(group: RunTaskGroup, task: RunTask): void
  /** 跳到它的终端；没有终端返回 false */
  focus(group: RunTaskGroup, task: RunTask): boolean
}
/** 跑 / 停 / 跳转；用 TerminalProvider 的 runTask 建终端（复用、改名、发命令） */
export function useTaskRunner(state: RunTaskState | null): TaskRunner {
  const ui = useTerminalUi()
  const root = state?.root ?? ''
  const { runTask, select } = ui
  const focus = useCallback(
    (group: RunTaskGroup, task: RunTask): boolean => {
      const run = runs.get(runKey(root, group, task))
      if (!run || !terminalState().terminals.some(r => r.id === run.terminalId)) return false
      select(run.terminalId)
      return true
    },
    [root, select],
  )
  const run = useCallback(
    async (group: RunTaskGroup, task: RunTask, fresh = false): Promise<void> => {
      const key = runKey(root, group, task)
      const status = statusOf(key)
      if (status.kind === 'running' && !fresh && focus(group, task)) return
      const reuse = fresh ? null : (runs.get(key)?.terminalId ?? idleTerminalNamed(task.name, root))
      const id = await runTask(task.name, taskCommand(group, task), reuse)
      if (id) setRun(key, { terminalId: id, stopped: false, demoOk: isDemo })
    },
    [root, runTask, focus],
  )
  const stop = useCallback(
    (group: RunTaskGroup, task: RunTask): void => {
      const key = runKey(root, group, task)
      const current = runs.get(key)
      const record = current && terminalState().terminals.find(r => r.id === current.terminalId)
      if (!current || !record) return
      if (!isDemo) void window.pixelsky!.terminal.write(record.id, record.generation, '\x03').catch(() => undefined)
      setRun(key, { ...current, stopped: true })
    },
    [root],
  )
  return { run, stop, focus }
}
