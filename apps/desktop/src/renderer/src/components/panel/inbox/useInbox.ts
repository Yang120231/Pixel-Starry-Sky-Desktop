// 任务 › 待处理 的数据（docs/ui/tasks-inbox.md）：引擎会话摘要 + 已打开会话的快照 + 本机「已处理」记录。
// 演示模式用 mock/inbox.ts，操作只改内存。
import { useMemo, useSyncExternalStore } from 'react'
import { useEngineState } from '@/engine'
import { machineOf, useMachines } from '@/machines/store'
import { isDemo } from '@/data'
import { buildInbox, type InboxItem } from './inboxModel'
import { demo } from '@/data/demo'

const KEY = 'pixelsky.inbox.dismissed.v1'
function load(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string')) as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}
let dismissed = load()
let demoItems: InboxItem[] = isDemo ? demo().inbox : []
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach(fn => fn())
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
function save(next: Record<string, string>): void {
  dismissed = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 本次运行仍然有效 */
  }
  emit()
}

/** 标记已处理：只记下当时的状态签名，状态再变就重新出现；演示模式直接移除 */
export function dismissInbox(item: InboxItem): void {
  if (isDemo) {
    demoItems = demoItems.filter(i => i.sessionId !== item.sessionId)
    emit()
    return
  }
  save({ ...dismissed, [item.sessionId]: item.signature })
}

/** 演示模式的操作：从列表移除（允许 / 拒绝 / 继续之后） */
export function resolveDemoInbox(sessionId: string): void {
  demoItems = demoItems.filter(i => i.sessionId !== sessionId)
  emit()
}

export function useInbox(): InboxItem[] {
  const sessions = useEngineState(s => s.sessions)
  const snapshots = useEngineState(s => s.snapshots)
  const projects = useEngineState(s => s.projects)
  const machine = useMachines().currentId
  const marks = useSyncExternalStore(subscribe, () => dismissed)
  const demo = useSyncExternalStore(subscribe, () => demoItems)
  return useMemo(() => {
    if (isDemo) return demo
    // 会话删除后清掉对应的「已处理」记录
    const ids = new Set(sessions.map(s => s.record.id))
    if (sessions.length && Object.keys(marks).some(id => !ids.has(id)))
      queueMicrotask(() => save(Object.fromEntries(Object.entries(dismissed).filter(([id]) => ids.has(id)))))
    return buildInbox({ sessions, snapshots, projects, onMachine: id => machineOf(id) === machine, dismissed: marks })
  }, [sessions, snapshots, projects, machine, marks, demo])
}
