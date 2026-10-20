// 固定到左侧栏的任务（docs/ui/files-search-terminal-pins.md §5）：任务卡片的图钉和拖到侧栏都走这里，
// 左侧栏的「固定」分组读这里。正式模式存在主进程（tasks.json 的 pinnedAt），演示模式只在本次运行内有效。
import { useEffect, useSyncExternalStore } from 'react'
import { isDemo } from '@/data'
import { useMachines } from '@/features/machines/store'
import type { ManualTask } from '../../../../shared/types/project-tools'

/** 任务卡片拖动时的数据类型（同时用于清单内排序） */
export const TASK_DRAG_TYPE = 'application/x-pixelsky-task'

let pinned: ManualTask[] = []
const listeners = new Set<() => void>()
function set(next: ManualTask[]): void {
  pinned = next
  listeners.forEach(fn => fn())
}

/** 拖动中的任务（演示模式需要整条任务；正式模式只用 id） */
let dragging: ManualTask | null = null
export const startTaskDrag = (task: ManualTask | null): void => {
  dragging = task
}
export const draggedTask = (): ManualTask | null => dragging

export async function reloadPinnedTasks(): Promise<void> {
  if (isDemo || !window.pixelsky) return
  set(await window.pixelsky.projectTools.pinnedTasks())
}

export async function pinTask(task: ManualTask, on: boolean): Promise<void> {
  if (isDemo) {
    const rest = pinned.filter(t => t.id !== task.id)
    set(on ? [...rest, { ...task, pinnedAt: Date.now() }] : rest)
    return
  }
  await window.pixelsky!.projectTools.pinTask(task.id, on)
  await reloadPinnedTasks()
}

/** 在侧栏里勾选完成 / 取消完成 */
export async function togglePinnedDone(task: ManualTask): Promise<void> {
  const status = task.status === 'completed' ? 'pending' : 'completed'
  if (isDemo) {
    set(pinned.map(t => (t.id === task.id ? { ...t, status } : t)))
    return
  }
  await window.pixelsky!.projectTools.updateTask(task.id, { status })
  await reloadPinnedTasks()
}

export function usePinnedTasks(): ManualTask[] {
  // 固定列表跟着当前机器走：切换机器后重新读
  const machine = useMachines().currentId
  useEffect(() => {
    if (isDemo || !window.pixelsky) return
    void reloadPinnedTasks().catch(() => undefined)
    // 任务被改动 / 删除、项目被移除后重新读
    return window.pixelsky.projectTools.onChange(
      kind => kind === 'state' && void reloadPinnedTasks().catch(() => undefined),
    )
  }, [machine])
  return useSyncExternalStore(
    fn => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    () => pinned,
  )
}
