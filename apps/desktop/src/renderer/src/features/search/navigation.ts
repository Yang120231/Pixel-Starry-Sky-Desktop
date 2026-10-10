import { useSyncExternalStore } from 'react'
import { expandItems } from './expand'

export interface ItemNavigation {
  sessionId: string
  itemId: string
  /** 搜索词（已折叠）：定位后在这条里标出命中（docs/ui/content-highlight.md §2 E） */
  terms: string[]
  token: number
}
let target: ItemNavigation | null = null
let sequence = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function navigateToItem(sessionId: string, itemId: string, terms: string[] = []): void {
  target = { sessionId, itemId, terms, token: ++sequence }
  // 命中可能在折叠着的部分（工具输出、待办等）：让这一条展开
  expandItems(sessionId, [itemId])
  emit()
}
export function finishItemNavigation(token: number): void {
  if (target?.token === token) {
    target = null
    emit()
  }
}
export function useItemNavigation(): ItemNavigation | null {
  return useSyncExternalStore(subscribe, () => target)
}
