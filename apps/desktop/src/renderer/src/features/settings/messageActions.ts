// 你发的消息上「复制 / 分叉 / 回退」放在哪里（GitHub #28，docs/ui/chat-fixes-queue-actions-cost.md §9）：
// 气泡左侧 / 气泡下方，保存在本机，多窗口同步，改了马上生效
import { useSyncExternalStore } from 'react'

export type MessageActionsPosition = 'left' | 'below'
export const MESSAGE_ACTIONS_KEY = 'pixelsky.message-actions'
export const DEFAULT_MESSAGE_ACTIONS: MessageActionsPosition = 'left'

const valid = (v: unknown): v is MessageActionsPosition => v === 'left' || v === 'below'

function read(): MessageActionsPosition {
  try {
    const value = localStorage.getItem(MESSAGE_ACTIONS_KEY)
    return valid(value) ? value : DEFAULT_MESSAGE_ACTIONS
  } catch {
    return DEFAULT_MESSAGE_ACTIONS
  }
}

let position: MessageActionsPosition = typeof window === 'undefined' ? DEFAULT_MESSAGE_ACTIONS : read()
const listeners = new Set<() => void>()

export function setMessageActionsPosition(next: MessageActionsPosition): void {
  if (!valid(next) || next === position) return
  position = next
  try {
    localStorage.setItem(MESSAGE_ACTIONS_KEY, position)
  } catch {
    /* 存储不可用时，本次仍然生效 */
  }
  listeners.forEach(listener => listener())
}

function onStorage(event: StorageEvent): void {
  if (event.storageArea !== localStorage || (event.key !== MESSAGE_ACTIONS_KEY && event.key !== null)) return
  const next = read()
  if (next === position) return
  position = next
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void): () => void {
  if (!listeners.size) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener('storage', onStorage)
  }
}

export function useMessageActionsPosition(): MessageActionsPosition {
  return useSyncExternalStore(
    subscribe,
    () => position,
    () => DEFAULT_MESSAGE_ACTIONS,
  )
}
