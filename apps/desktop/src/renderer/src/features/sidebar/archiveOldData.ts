// 批量归档旧会话的数据：从引擎（演示模式从演示数据）收集候选，逐个调用现有归档接口，以及打开对话框的入口。
import { useSyncExternalStore } from 'react'
import { projects as demoProjects } from '@/data'
import { demo, demoSessionChanges } from '@/data/demo'
import { tr, translateMessage } from '@/i18n/core'
import { busy } from '@/features/engine/sidebarData'
import { bridge, getEngineState, isLive } from '@/features/engine'
import { getMachines, machineOf } from '@/features/machines/store'
import { getChannels } from '@/features/channels/store'
import { getPaneState, paneActions } from '@/features/panes/store'
import { leaves } from '@/features/panes/tree'
import { DAY_MS, isRunningError, type ArchiveItem } from './archiveOld'

/** 当前机器上的项目（对话框右上的范围下拉用） */
export function archiveScopes(): Array<{ id: string; name: string }> {
  if (!isLive)
    return (demo().machineProjects?.[getMachines().currentId] ?? demoProjects).map(p => ({ id: p.id, name: p.name }))
  return getEngineState()
    .projects.filter(p => machineOf(p.id) === getMachines().currentId)
    .map(p => ({ id: p.id, name: p.name }))
}

/** 当前机器上所有没归档的会话（带不能归档的标记）；不是 hook，订阅由调用方负责 */
export function collectArchiveItems(now = Date.now()): ArchiveItem[] {
  const opened = new Set(leaves(getPaneState().layout.root).flatMap(l => l.tabs))
  const { sessionBindings, sessionChannels } = getChannels()
  const inChannel = (id: string): boolean => (sessionBindings[id]?.length ?? 0) > 0 || id in sessionChannels
  if (!isLive) {
    const changes = demoSessionChanges(),
      own = demo().machineProjects?.[getMachines().currentId]
    return (own ?? demoProjects).flatMap(p =>
      p.sessions
        .filter(s => !changes[s.id]?.deleted && !(changes[s.id] ? changes[s.id].archivedAt : s.archivedAt))
        .map(s => ({
          id: s.id,
          title: changes[s.id]?.title ?? s.title,
          projectId: p.id,
          projectName: p.name,
          lastActive: now - (demo().idleDays[s.id] ?? 0) * DAY_MS,
          pinned: !!(changes[s.id]?.pinnedAt === undefined ? s.pinnedAt : changes[s.id].pinnedAt),
          running: s.status === 'running' && !changes[s.id]?.stopped,
          open: opened.has(s.id),
          channel: inChannel(s.id),
        })),
    )
  }
  const { projects, sessions } = getEngineState(),
    here = getMachines().currentId,
    names = new Map(projects.filter(p => machineOf(p.id) === here).map(p => [p.id, p.name]))
  return sessions
    .filter(s => !s.record.archivedAt && names.has(s.record.projectId))
    .map(s => ({
      id: s.record.id,
      title: s.record.title,
      projectId: s.record.projectId,
      projectName: names.get(s.record.projectId)!,
      lastActive: s.record.updatedAt,
      pinned: !!s.record.pinnedAt,
      running: busy(s),
      open: opened.has(s.record.id),
      channel: inChannel(s.record.id),
    }))
}

export interface BatchResult {
  done: string[]
  failed: Array<{ id: string; message: string }>
}

/** 逐个归档 / 恢复（数量多就慢慢来，onProgress 报告已处理几个）；一个失败不影响后面的 */
async function runBatch(
  ids: readonly string[],
  archive: boolean,
  onProgress?: (handled: number) => void,
): Promise<BatchResult> {
  const result: BatchResult = { done: [], failed: [] }
  for (const id of ids) {
    try {
      // 不带 stopRunning：归档途中变成运行中的会话会报 SESSION_RUNNING，算失败，不替用户停掉
      if (isLive && bridge) await bridge.archiveSession(id, archive, false)
      else demo().sessions.change(id, archive ? { archivedAt: Date.now(), stopped: true } : { archivedAt: null })
      result.done.push(id)
    } catch (error) {
      const raw = (error as Error).message
      result.failed.push({ id, message: isRunningError(raw) ? tr('archiveOld.failedRunning') : translateMessage(raw) })
    }
    onProgress?.(result.done.length + result.failed.length)
  }
  if (archive && result.done.length) paneActions.closeSessions(new Set(result.done))
  return result
}
export const archiveBatch = (ids: readonly string[], onProgress?: (handled: number) => void): Promise<BatchResult> =>
  runBatch(ids, true, onProgress)
export const restoreBatch = (ids: readonly string[]): Promise<BatchResult> => runBatch(ids, false)

// 对话框的入口：项目菜单传项目 id，侧栏项目区的菜单传 null（全部项目）
let request: { projectId: string | null } | null = null
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach(l => l())
export const openArchiveOld = (projectId: string | null): void => {
  request = { projectId }
  emit()
}
export const closeArchiveOld = (): void => {
  request = null
  emit()
}
export function useArchiveOldRequest(): { projectId: string | null } | null {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => request,
  )
}
