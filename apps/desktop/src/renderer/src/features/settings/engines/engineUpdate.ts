// 引擎一键更新的状态（docs/ui/engine-update.md）：列表那一行和详情页共用，切页面不丢「更新中」和结果。
import { useSyncExternalStore } from 'react'
import { isNewerVersion, type EngineId, type EngineUpdateResult } from '@pixelsky/protocol'
import { tr } from '../../../i18n/core'
import { bridge } from '@/features/engine'
import type { EngineLite } from '@/data/types'

export type UpdateOutcome = (EngineUpdateResult & { before: string | null }) | { error: string }
export interface UpdateState {
  updating: boolean
  result: UpdateOutcome | null
}

const IDLE: UpdateState = { updating: false, result: null }
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

/** npm 上有比本机新的版本 */
export function hasNewer(e: EngineLite): boolean {
  return canUpdate(e) && isNewerVersion(e.latestVersion, e.version)
}

export async function updateEngine(e: EngineLite): Promise<void> {
  if (states.get(e.id)?.updating) return
  if (!bridge) {
    set(e.id, { updating: false, result: { error: tr('settings.engines.EngineDetail.demoModeCannotUpdate') } })
    return
  }
  const before = e.version
  set(e.id, { updating: true, result: null })
  try {
    set(e.id, { updating: false, result: { ...(await bridge.updateEngine(e.id)), before } })
  } catch (err) {
    set(e.id, { updating: false, result: { error: (err as Error).message } })
  }
}

export function clearUpdateResult(engine: EngineId): void {
  if (states.get(engine)?.result) set(engine, { updating: false, result: null })
}

function subscribe(listener: () => void): () => void {
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

/** 结果的一句话：更新到哪个版本、已是最新、没完成 */
export function outcomeTitle(result: UpdateOutcome): string {
  if ('error' in result) return result.error
  const changed = result.version && result.before && result.version !== result.before
  return !result.ok
    ? tr('settings.engines.EngineDetail.updateDidNotComplete')
    : changed
      ? tr('settings.engines.EngineDetail.updatedToPreviously', { p0: result.version, p1: result.before })
      : tr('settings.engines.EngineDetail.alreadyUpToDate', { p0: result.version ? `（${result.version}）` : '' })
}
