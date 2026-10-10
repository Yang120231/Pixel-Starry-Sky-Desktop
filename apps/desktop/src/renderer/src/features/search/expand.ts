// 让对话里折叠着的条目展开（docs/ui/conversation-ux.md §2.6）：对话内搜索的「展开」和全局搜索跳转共用。
// 条目（思考、工具行、待办、提示详情）用 useExpandRequest 订阅自己的请求，请求一来就展开。
import { createContext, useContext, useSyncExternalStore } from 'react'

/** 条目所在的会话：LiveTranscript 提供。追踪面板等别处没有，不响应展开请求 */
export const ExpandScope = createContext<string | null>(null)

/** 请求多久以内还算数：条目可能稍后才挂载（跳转到还没打开的会话），但很久以后重新挂载时不该再展开 */
export const REQUEST_MS = 5000

export interface ExpandRequest {
  /** 第几次请求：每次请求都是新对象，订阅方据此重新展开 */
  n: number
  at: number
}

const requests = new Map<string, ExpandRequest>()
const listeners = new Set<() => void>()
const key = (sessionId: string, itemId: string): string => `${sessionId}\n${itemId}`
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function expandItems(sessionId: string, itemIds: readonly string[], now = Date.now()): void {
  if (itemIds.length === 0) return
  for (const id of itemIds) {
    const k = key(sessionId, id)
    requests.set(k, { n: (requests.get(k)?.n ?? 0) + 1, at: now })
  }
  listeners.forEach(l => l())
}

export function expandRequest(sessionId: string | null, itemId: string): ExpandRequest | null {
  return sessionId ? (requests.get(key(sessionId, itemId)) ?? null) : null
}

/** 请求还有效：没过期 */
export const freshRequest = (request: ExpandRequest | null, now = Date.now()): boolean =>
  !!request && now - request.at < REQUEST_MS

/** 这一条最近的展开请求；变成新对象且没过期时，调用方展开 */
export function useExpandRequest(itemId: string): ExpandRequest | null {
  const sessionId = useContext(ExpandScope)
  return useSyncExternalStore(
    subscribe,
    () => expandRequest(sessionId, itemId),
    () => null,
  )
}
