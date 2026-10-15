// 「任务」的数据和运行（docs/ui/coding-tasks.md §3、§4）：读任务列表（按工作区缓存）、任务 → 终端的内存对应、跑 / 停 / 跳到终端
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { GradleListedTask, RunTask, RunTaskGroup, RunTaskState } from '../../../../../shared/types/project-tools'
import type { WorkspaceRef } from '../../../../../shared/types/workspace'
import { isDemo } from '@/data'
import { demo } from '@/data/demo'
import { subscribePacks } from '@/features/extpacks/store'
import { FILE_SAVED_EVENT } from '@/features/files/store'
import { terminalState, useTerminalStore } from '@/features/terminal/store'
import { useTerminalUi } from '@/features/terminal/TerminalProvider'
import {
  gradleBuildKey,
  IDLE,
  isTaskFile,
  mergeGradleFull,
  taskCommand,
  taskKey,
  taskStatus,
  taskTitle,
  type GradleFull,
  type TaskStatus,
} from './model'
import { activeTaskTemplates, extTaskFileNames } from './extTemplates'

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

/** 上一次读任务时用的扩展模板（序列化）；扩展变化后模板没变就不用重读 */
let templatesSig = ''
let packsWatched = false
/** 扩展装上 / 停用 / 改动后：模板变了就让缓存作废，已经读过的工作区重新读（视图没挂载的下次显示时 at=0 也会重读） */
function watchPacks(): void {
  if (packsWatched || typeof window === 'undefined') return
  packsWatched = true
  subscribePacks(() => {
    const sig = JSON.stringify(activeTaskTemplates())
    if (sig === templatesSig) return
    templatesSig = sig
    for (const [key, entry] of entries) {
      patch(key, { at: 0 })
      if (entry.state && refs.has(key)) void loadTasks(refs.get(key)!)
    }
  })
}

/** 读任务；maxAge 内读过就不再读（0 = 总是读）。同一工作区同时只读一次 */
export async function loadTasks(ref: WorkspaceRef, maxAge = 0): Promise<void> {
  const key = refKey(ref)
  const current = entries.get(key)
  if (current?.loading) return
  if (current?.state && maxAge > 0 && Date.now() - current.at < maxAge) return
  refs.set(key, ref)
  watchPacks()
  if (isDemo) {
    patch(key, { state: demo().projectTools.runTasks, loading: false, error: null, at: Date.now() })
    return
  }
  patch(key, { loading: true, error: null })
  try {
    const templates = activeTaskTemplates()
    const used = JSON.stringify(templates)
    templatesSig = used
    const state = await window.pixelsky!.projectTools.runTasks(ref, templates)
    patch(key, { state, loading: false, error: null, at: Date.now() })
    // 读的时候扩展又变了（读的过程中重读会被跳过）：补读一次
    if (JSON.stringify(activeTaskTemplates()) !== used) void loadTasks(ref)
  } catch (cause) {
    patch(key, { loading: false, error: cause instanceof Error ? cause.message : String(cause) })
  }
}

// ---- Gradle 完整任务列表（docs/ui/coding-tasks.md §9.2）：按构建记在 localStorage ----
const FULL_KEY = isDemo ? 'pixelsky.coding.tasks.gradleFull.demo' : 'pixelsky.coding.tasks.gradleFull'
/** 最多记这么多个构建、每个构建这么多个任务 */
const MAX_FULL_BUILDS = 20
const MAX_FULL_TASKS = 3000
function readFulls(): Map<string, GradleFull> {
  try {
    const data = JSON.parse(localStorage.getItem(FULL_KEY) ?? '{}') as Record<string, GradleFull>
    return new Map(Object.entries(data).filter(([, v]) => v && typeof v.stamp === 'string' && Array.isArray(v.tasks)))
  } catch {
    return new Map()
  }
}
let fulls = typeof window === 'undefined' ? new Map<string, GradleFull>() : readFulls()
/** 正在加载 / 上次失败的构建 */
export interface GradleJob {
  loading: boolean
  error: string | null
}
const jobs = new Map<string, GradleJob>()
/** 完整列表或加载状态每变一次加一 */
let fullVersion = 0
function fullsChanged(): void {
  fullVersion++
  notify()
}
function saveFulls(): void {
  const recent = [...fulls].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_FULL_BUILDS)
  fulls = new Map(recent)
  try {
    localStorage.setItem(FULL_KEY, JSON.stringify(Object.fromEntries(recent)))
  } catch {
    // 存不了就只在这次有效
  }
}

/** 演示模式的完整列表：在推断的基础上多几个 */
function demoListed(state: RunTaskState, buildDir: string): GradleListedTask[] {
  const listed: GradleListedTask[] = []
  for (const group of state.groups) {
    const g = group.gradle
    if (!g || g.buildDir !== buildDir) continue
    for (const t of group.tasks)
      listed.push({ project: g.project, name: t.name, category: t.category || 'other', description: t.detail })
    listed.push(
      {
        project: g.project,
        name: 'buildEnvironment',
        category: 'help',
        description: 'Displays all buildscript dependencies.',
      },
      {
        project: g.project,
        name: 'outgoingVariants',
        category: 'help',
        description: 'Displays the outgoing variants.',
      },
    )
  }
  return listed
}

/** 跑 gradlew tasks --all 读完整列表（点了才跑）；stamp 是当前构建文件的指纹 */
export async function loadGradleFull(ref: WorkspaceRef, root: string, buildDir: string, stamp: string): Promise<void> {
  const key = gradleBuildKey(root, buildDir)
  if (jobs.get(key)?.loading) return
  jobs.set(key, { loading: true, error: null })
  fullsChanged()
  try {
    let tasks: GradleListedTask[]
    if (isDemo) {
      await new Promise(r => setTimeout(r, 1200))
      if (!jobs.get(key)?.loading) return
      tasks = demoListed(entries.get(refKey(ref))?.state ?? demo().projectTools.runTasks, buildDir)
    } else tasks = await window.pixelsky!.projectTools.gradleTasks(ref, buildDir)
    if (!jobs.get(key)?.loading) return
    fulls.set(key, { at: Date.now(), stamp, tasks: tasks.slice(0, MAX_FULL_TASKS) })
    saveFulls()
    jobs.delete(key)
  } catch (cause) {
    // 取消的不算失败
    if (jobs.get(key)?.loading)
      jobs.set(key, { loading: false, error: cause instanceof Error ? cause.message : String(cause) })
  }
  fullsChanged()
}
export function cancelGradleFull(ref: WorkspaceRef, root: string, buildDir: string): void {
  const key = gradleBuildKey(root, buildDir)
  if (!jobs.get(key)?.loading) return
  jobs.delete(key)
  fullsChanged()
  if (!isDemo) void window.pixelsky!.projectTools.gradleTasksCancel(ref, buildDir).catch(() => undefined)
}
/** 一个构建的完整列表记录和加载状态 */
export function useGradleFull(root: string, buildDir: string): { full: GradleFull | null; job: GradleJob | null } {
  useSyncExternalStore(subscribe, () => fullVersion)
  const key = gradleBuildKey(root, buildDir)
  return { full: fulls.get(key) ?? null, job: jobs.get(key) ?? null }
}

/** 缓存 + 完整列表合起来的结果；同一份输入返回同一个对象（useSyncExternalStore 要求） */
const views = new Map<string, { base: TasksEntry; version: number; value: TasksEntry }>()
function view(key: string): TasksEntry {
  const base = entries.get(key) ?? EMPTY
  const cached = views.get(key)
  if (cached && cached.base === base && cached.version === fullVersion) return cached.value
  const value = base.state ? { ...base, state: mergeGradleFull(base.state, fulls) } : base
  views.set(key, { base, version: fullVersion, value })
  return value
}

/** 这个工作区的任务列表（不自动读；调用 loadTasks）；Gradle 构建有完整列表时用完整列表 */
export function useRunTasks(ref: WorkspaceRef | null): TasksEntry {
  const key = ref ? refKey(ref) : ''
  return useSyncExternalStore(subscribe, () => view(key))
}
/** 不在 React 里取当前缓存（编辑器 ▶ 用） */
export const getRunTasks = (ref: WorkspaceRef | null): TasksEntry => (ref ? view(refKey(ref)) : EMPTY)

const normRoot = (root: string): string => root.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
// 编辑器保存了 package.json / Makefile / Cargo.toml / Gradle 的文件：根目录相同的缓存重新读
if (typeof window !== 'undefined')
  window.addEventListener(FILE_SAVED_EVENT, event => {
    const { root, path } = (event as CustomEvent<{ root: string; path: string }>).detail
    if (!isTaskFile(path, extTaskFileNames())) return
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
  /** 运行：还在跑就只跳到它的终端；fresh = 总是新开终端；args 接在命令后面（Gradle 的「带参数运行」） */
  run(group: RunTaskGroup, task: RunTask, fresh?: boolean, args?: string): Promise<void>
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
    async (group: RunTaskGroup, task: RunTask, fresh = false, args = ''): Promise<void> => {
      const key = runKey(root, group, task)
      const status = statusOf(key)
      if (status.kind === 'running' && !fresh && focus(group, task)) return
      const title = taskTitle(group, task)
      const reuse = fresh ? null : (runs.get(key)?.terminalId ?? idleTerminalNamed(title, root))
      const extra = args.trim()
      const id = await runTask(title, program => taskCommand(group, task, program) + (extra ? ` ${extra}` : ''), reuse)
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
