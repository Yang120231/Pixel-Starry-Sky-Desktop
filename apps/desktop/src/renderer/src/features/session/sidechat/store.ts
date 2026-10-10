// 旁聊（docs/ui/rewind-fork-sidechat.md §3）：每个会话一串问答，只在内存里；问的时候带上前面已经答完的几问
import { useSyncExternalStore } from 'react'
import type { SideTurn } from '@pixelsky/protocol'
import { translateMessage } from '@/i18n/core'

export interface SideEntry {
  id: string
  question: string
  answer: string | null
  error: string | null
  pending: boolean
}

/** 真正去问的函数：桌面版走引擎，演示模式用演示数据 */
export type SideAsk = (sessionId: string, question: string, history: SideTurn[]) => Promise<string>
export type SideCancel = (sessionId: string) => Promise<void> | void

let chats: Record<string, SideEntry[]> = {}
const listeners = new Set<() => void>()
const EMPTY: SideEntry[] = []

function set(sessionId: string, entries: SideEntry[]): void {
  chats = { ...chats, [sessionId]: entries }
  listeners.forEach(l => l())
}

function patch(sessionId: string, id: string, change: Partial<SideEntry>): void {
  const entries = chats[sessionId]
  if (!entries?.some(e => e.id === id)) return
  set(
    sessionId,
    entries.map(e => (e.id === id ? { ...e, ...change } : e)),
  )
}

export function sideEntries(sessionId: string): SideEntry[] {
  return chats[sessionId] ?? EMPTY
}

export function useSideChat(sessionId: string): SideEntry[] {
  return useSyncExternalStore(
    l => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => sideEntries(sessionId),
  )
}

/** 问一个问题；同一时间只有一个在答 */
export async function askSide(sessionId: string, question: string, ask: SideAsk): Promise<void> {
  const text = question.trim()
  const entries = sideEntries(sessionId)
  if (!text || entries.some(e => e.pending)) return
  const history = entries.flatMap(e => (e.answer !== null ? [{ question: e.question, answer: e.answer }] : []))
  const id = crypto.randomUUID()
  set(sessionId, [...entries, { id, question: text, answer: null, error: null, pending: true }])
  try {
    const answer = await ask(sessionId, text, history)
    patch(sessionId, id, { answer, pending: false })
  } catch (err) {
    patch(sessionId, id, { error: translateMessage((err as Error).message), pending: false })
  }
}

export function stopSide(sessionId: string, cancel: SideCancel): void {
  const pending = sideEntries(sessionId).find(e => e.pending)
  if (!pending) return
  void cancel(sessionId)
}

export function clearSide(sessionId: string, cancel: SideCancel): void {
  stopSide(sessionId, cancel)
  set(sessionId, [])
}
