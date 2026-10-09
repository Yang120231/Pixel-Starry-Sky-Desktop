import { useSyncExternalStore } from 'react'
export interface DemoSessionChange {
  archivedAt: number | null
  deleted: boolean
  stopped: boolean
  title?: string
  bottomedAt?: number | null
}
let changes: Record<string, DemoSessionChange> = {}
const listeners = new Set<() => void>()
export const getDemoSessionChanges = (): Record<string, DemoSessionChange> => changes
export function changeDemoSession(id: string, patch: Partial<DemoSessionChange>): void {
  const previous = changes[id] ?? { archivedAt: null, deleted: false, stopped: false }
  changes = { ...changes, [id]: { ...previous, ...patch } }
  for (const listener of listeners) listener()
}
export function useDemoSessionChanges(): Record<string, DemoSessionChange> {
  return useSyncExternalStore(callback => {
    listeners.add(callback)
    return () => listeners.delete(callback)
  }, getDemoSessionChanges)
}
