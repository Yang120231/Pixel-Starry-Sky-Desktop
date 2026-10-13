import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useSession } from '@/features/engine'
import { codingLayout } from '../layoutStore'
import { aiCommandEntries, type AiCommandEntry } from './aiCommandsModel'

// AI 命令的小 store：当前选中的一条、输出页的来源，以及每个会话最近一次读到的命令（快照被释放后照样能看）

const EMPTY: readonly AiCommandEntry[] = []
const MAX_CACHED_SESSIONS = 20
const cache = new Map<string, readonly AiCommandEntry[]>()

export type OutputSource =
  | { kind: 'terminal'; id: string }
  | { kind: 'service'; id: string }
  | { kind: 'ai'; sessionId: string; itemId: string }
  | null

interface BottomState {
  selected: { sessionId: string; itemId: string } | null
  output: OutputSource
}
let state: BottomState = { selected: null, output: null }
const listeners = new Set<() => void>()
function set(patch: Partial<BottomState>): void {
  state = { ...state, ...patch }
  listeners.forEach(fn => fn())
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export function useBottomState(): BottomState {
  return useSyncExternalStore(subscribe, () => state)
}
export function selectAiCommand(sessionId: string, itemId: string): void {
  if (state.selected?.sessionId === sessionId && state.selected.itemId === itemId) return
  set({ selected: { sessionId, itemId } })
}
export function setOutputSource(source: OutputSource): void {
  set({ output: source })
}

function remember(sessionId: string, entries: readonly AiCommandEntry[]): void {
  cache.delete(sessionId)
  cache.set(sessionId, entries)
  while (cache.size > MAX_CACHED_SESSIONS) cache.delete(cache.keys().next().value!)
}
/** 某个会话的命令（最近 200 条）。快照在内存里就用快照，否则用最近一次缓存 */
export function useAiCommands(sessionId: string | null): readonly AiCommandEntry[] {
  const snapshot = useSession(sessionId)
  const items = snapshot?.items
  const live = useMemo(() => (items ? aiCommandEntries(items) : null), [items])
  useEffect(() => {
    if (sessionId && live) remember(sessionId, live)
  }, [sessionId, live])
  return live ?? (sessionId ? (cache.get(sessionId) ?? EMPTY) : EMPTY)
}

/** 切到「AI 命令」并选中这一条（给对话里命令行的「在终端里看 ›」用） */
export function revealAiCommand(sessionId: string, itemId: string): void {
  selectAiCommand(sessionId, itemId)
  codingLayout.showBottom('aiCommands')
}
