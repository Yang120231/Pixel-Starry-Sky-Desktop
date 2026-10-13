// 长对话先显示最近几轮（docs/ui/turn-rail.md §9，D121）：20 轮 / 50 轮 / 全部，保存在本机，多窗口同步
import { useSyncExternalStore } from 'react'
import { capTurns, useLightweight } from '@/features/recovery/lightweight'

export type LongConversationChoice = '20' | '50' | 'all'
export const LONG_CONVERSATION_KEY = 'pixelsky.long-conversation'
export const DEFAULT_LONG_CONVERSATION: LongConversationChoice = '20'

const valid = (v: unknown): v is LongConversationChoice => v === '20' || v === '50' || v === 'all'

function read(): LongConversationChoice {
  try {
    const value = localStorage.getItem(LONG_CONVERSATION_KEY)
    return valid(value) ? value : DEFAULT_LONG_CONVERSATION
  } catch {
    return DEFAULT_LONG_CONVERSATION
  }
}

let choice: LongConversationChoice = typeof window === 'undefined' ? DEFAULT_LONG_CONVERSATION : read()
const listeners = new Set<() => void>()

export function setLongConversation(next: LongConversationChoice): void {
  if (!valid(next) || next === choice) return
  choice = next
  try {
    localStorage.setItem(LONG_CONVERSATION_KEY, choice)
  } catch {
    /* 存储不可用时，本次仍然生效 */
  }
  listeners.forEach(listener => listener())
}

function onStorage(event: StorageEvent): void {
  if (event.storageArea !== localStorage || (event.key !== LONG_CONVERSATION_KEY && event.key !== null)) return
  const next = read()
  if (next === choice) return
  choice = next
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

export function useLongConversation(): LongConversationChoice {
  return useSyncExternalStore(
    subscribe,
    () => choice,
    () => DEFAULT_LONG_CONVERSATION,
  )
}

/** 先显示最近几轮，也是每次「显示更早的」补几轮；null：全部显示，不折叠 */
export function useTranscriptWindowSize(): number | null {
  const value = useLongConversation()
  // 崩溃恢复后的轻量模式：不管设置是 50 还是全部，最多 20 轮（不改设置）
  return capTurns(value === 'all' ? null : Number(value), useLightweight())
}
