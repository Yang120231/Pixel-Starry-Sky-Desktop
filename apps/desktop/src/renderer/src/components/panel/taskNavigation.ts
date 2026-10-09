import { useSyncExternalStore } from 'react'
export interface TaskLocation { projectId: string; taskId: string; seq: number }
let current: TaskLocation | null = null
const listeners = new Set<() => void>()
export function requestTask(projectId: string, taskId: string): void {
  current = { projectId, taskId, seq: Date.now() }
  listeners.forEach(listener => listener())
  window.dispatchEvent(new CustomEvent('pixelsky:open-task', { detail: current }))
}
export function useTaskLocation(): TaskLocation | null {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => current)
}
