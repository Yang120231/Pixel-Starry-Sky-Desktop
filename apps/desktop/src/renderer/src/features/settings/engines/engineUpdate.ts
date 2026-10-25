// 引擎一键安装 / 更新的状态（docs/ui/engine-update.md）：列表那一行和详情页共用，切页面不丢「进行中」和结果。
// 进度：主进程推 engine_job（阶段 + 最后一行输出），拿不到百分比，界面按以往用时显示模拟进度
import { useSyncExternalStore } from 'react'
import { isNewerVersion, type EngineId, type EngineJob, type EngineUpdateResult } from '@pixelsky/protocol'
import { tr } from '../../../i18n/core'
import { bridge } from '@/features/engine'
import { median } from '@/ui/simulatedProgress'
import type { EngineLite } from '@/data/types'

export type JobAction = EngineJob['action']
export type UpdateOutcome =
  | (EngineUpdateResult & { before: string | null; action: JobAction })
  | { error: string; action: JobAction }
export interface UpdateState {
  /** 正在安装或更新 */
  updating: boolean
  action: JobAction | null
  /** 最近一次进度（结束后留着，详情页显示满格或失败） */
  job: EngineJob | null
  result: UpdateOutcome | null
}

const IDLE: UpdateState = { updating: false, action: null, job: null, result: null }
const states = new Map<EngineId, UpdateState>()
const listeners = new Set<() => void>()

function set(engine: EngineId, next: UpdateState): void {
  states.set(engine, next)
  listeners.forEach(listener => listener())
}

/** 能在软件里更新：引擎支持，而且装着（没找到、不支持的不显示按钮） */
export function canUpdate(e: EngineLite): boolean {
  return e.caps.selfUpdate && e.status !== 'missing' && e.status !== 'unsupported'
}

/** 没装、检测说能一键安装 */
export function canInstall(e: EngineLite): boolean {
  return e.status === 'missing' && e.installable === true
}

/** npm 上有比本机新的版本 */
export function hasNewer(e: EngineLite): boolean {
  return canUpdate(e) && isNewerVersion(e.latestVersion, e.version)
}

// —— 预计用时：按本机以往成功的几次（每个引擎、每种操作各记最近 5 次）的中位数 ——
const DURATIONS = 'pixelsky.engineJobDurations'
const DEFAULT_MS: Record<JobAction, number> = { install: 90_000, update: 60_000 }

function loadDurations(): Record<string, number[]> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DURATIONS) ?? '{}')
    return saved && typeof saved === 'object' ? (saved as Record<string, number[]>) : {}
  } catch {
    return {}
  }
}

export function expectedJobMs(engine: EngineId, action: JobAction): number {
  const list = loadDurations()[`${engine}:${action}`]
  return (Array.isArray(list) ? median(list.filter(n => typeof n === 'number' && n > 0)) : null) ?? DEFAULT_MS[action]
}

function recordDuration(job: EngineJob): void {
  const key = `${job.engine}:${job.action}`
  const all = loadDurations()
  all[key] = [...(Array.isArray(all[key]) ? all[key] : []), Date.now() - job.startedAt].slice(-5)
  try {
    localStorage.setItem(DURATIONS, JSON.stringify(all))
  } catch {
    // 存不下就用默认值
  }
}

/** 主进程推来的进度：只认正在跑的那一项（别的窗口发起的也认，进度跟着显示） */
function onJob(job: EngineJob): void {
  const prev = states.get(job.engine) ?? IDLE
  const running = job.phase !== 'done' && job.phase !== 'failed'
  if (job.phase === 'done') recordDuration(job)
  set(job.engine, { ...prev, updating: running || prev.updating, action: job.action, job })
}

let listening = false
function listen(): void {
  if (listening || !bridge) return
  listening = true
  bridge.onEvent(e => {
    if (e.kind === 'engine_job') onJob(e.job)
  })
}

async function runJob(e: EngineLite, action: JobAction): Promise<void> {
  if (states.get(e.id)?.updating) return
  if (!bridge) {
    const error = action === 'install' ? tr('engineJob.demo') : tr('settings.engines.EngineDetail.demoModeCannotUpdate')
    set(e.id, { ...IDLE, result: { error, action } })
    return
  }
  listen()
  const before = e.version
  // 主进程的第一条进度到之前先显示「准备中」
  set(e.id, {
    updating: true,
    action,
    job: { engine: e.id, action, phase: 'prepare', startedAt: Date.now(), line: null, error: null },
    result: null,
  })
  try {
    const result = await (action === 'install' ? bridge.installEngine(e.id) : bridge.updateEngine(e.id))
    set(e.id, { ...(states.get(e.id) ?? IDLE), updating: false, result: { ...result, before, action } })
  } catch (err) {
    set(e.id, { ...(states.get(e.id) ?? IDLE), updating: false, result: { error: (err as Error).message, action } })
  }
}

export function updateEngine(e: EngineLite): Promise<void> {
  return runJob(e, 'update')
}

export function installEngine(e: EngineLite): Promise<void> {
  return runJob(e, 'install')
}

function subscribe(listener: () => void): () => void {
  listen()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useEngineUpdate(engine: EngineId): UpdateState {
  return useSyncExternalStore(
    subscribe,
    () => states.get(engine) ?? IDLE,
    () => IDLE,
  )
}

/** 结果的一句话：装好了 / 更新到哪个版本、已是最新、没完成 */
export function outcomeTitle(result: UpdateOutcome): string {
  if ('error' in result) return result.error
  if (result.action === 'install')
    return result.ok ? tr('engineJob.installed', { p0: result.version ?? '' }).trim() : tr('engineJob.installFailed')
  const changed = result.version && result.before && result.version !== result.before
  return !result.ok
    ? tr('settings.engines.EngineDetail.updateDidNotComplete')
    : changed
      ? tr('settings.engines.EngineDetail.updatedToPreviously', { p0: result.version, p1: result.before })
      : tr('settings.engines.EngineDetail.alreadyUpToDate', { p0: result.version ? `（${result.version}）` : '' })
}
