// 演示模式下对会话的改动只存在内存里（归档、删除、停止、改名、置底），经 data/demo.ts 的 DemoSessions 取用
import type { DemoSessions } from '@/data/demo'
import type { DemoSessionChange } from '@/data/types'

let changes: Record<string, DemoSessionChange> = {}
const listeners = new Set<() => void>()

export const demoSessions: DemoSessions = {
  get: () => changes,
  change(id, patch) {
    const previous = changes[id] ?? { archivedAt: null, deleted: false, stopped: false }
    changes = { ...changes, [id]: { ...previous, ...patch } }
    for (const listener of listeners) listener()
  },
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
