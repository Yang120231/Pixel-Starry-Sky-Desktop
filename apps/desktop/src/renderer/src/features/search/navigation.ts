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

/**
 * 程序要滚动对话区之前发给它的滚动容器（.conversation-scroller）：对话区收到后暂时不贴底，直到用户自己滚动或操作。
 * 不先发的话，同一帧里对话流变高（content-visibility 渲染新区域、展开折叠的代码块）会被当成新内容，又贴回底部
 */
export const DETACH_EVENT = 'pixelsky:conversation-detach'
export const detachConversation = (scroller: HTMLElement): void => {
  scroller.dispatchEvent(new Event(DETACH_EVENT))
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
