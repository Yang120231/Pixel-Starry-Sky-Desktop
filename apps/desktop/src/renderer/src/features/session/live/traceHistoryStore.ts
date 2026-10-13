// 追踪面板「历史」的本机状态（docs/ui/trace-history.md §3，D130）：
// 看过哪些失败 / 停止的项、每个会话的清空时间点、「只看这一轮」开关。只存 localStorage，不云同步。
import { useSyncExternalStore } from 'react'
import { SESSION_REMOVED_EVENT } from '@/features/engine/sessionLifecycle'

export const TRACE_SEEN_KEY = 'pixelsky.trace.seen'
export const TRACE_CLEARED_KEY = 'pixelsky.trace.cleared'
export const TRACE_ONLY_TURN_KEY = 'pixelsky.trace.onlyTurn'

/** 每个会话最多记这么多个看过的 id，旧的丢掉 */
const MAX_SEEN = 200
/** 最多记这么多个会话，最早写的丢掉 */
const MAX_SESSIONS = 300

export interface TraceHistoryState {
  seen: ReadonlySet<string>
  clearedAt: number | null
  onlyTurn: boolean
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 存不了就只在这次打开里有效
  }
}

function parseRecord(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function parseSeen(raw: string | null): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [id, list] of Object.entries(parseRecord(raw)))
    if (Array.isArray(list)) out[id] = list.filter((x): x is string => typeof x === 'string')
  return out
}

function parseCleared(raw: string | null): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, at] of Object.entries(parseRecord(raw)))
    if (typeof at === 'number' && Number.isFinite(at)) out[id] = at
  return out
}

/** 会话数超出上限时删最早的（对象键保持插入顺序） */
function capSessions<T>(map: Record<string, T>): Record<string, T> {
  const ids = Object.keys(map)
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SESSIONS))) delete map[id]
  return map
}

// ---- 订阅与快照 ----

const listeners = new Set<() => void>()
const emit = () => listeners.forEach(fn => fn())

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  const onStorage = (e: Event) => {
    const key = (e as StorageEvent).key
    if (!key || key === TRACE_SEEN_KEY || key === TRACE_CLEARED_KEY || key === TRACE_ONLY_TURN_KEY) fn()
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

// 按会话缓存：原始字符串没变就返回同一个对象，useSyncExternalStore 的快照才稳定
const cache = new Map<string, { raw: [string | null, string | null, string | null]; state: TraceHistoryState }>()

export function readTraceHistoryState(sessionId: string): TraceHistoryState {
  const seenRaw = readRaw(TRACE_SEEN_KEY)
  const clearedRaw = readRaw(TRACE_CLEARED_KEY)
  const onlyRaw = readRaw(TRACE_ONLY_TURN_KEY)
  const raw: [string | null, string | null, string | null] = [seenRaw, clearedRaw, onlyRaw]
  const hit = cache.get(sessionId)
  if (hit && hit.raw.every((x, i) => x === raw[i])) return hit.state
  const state: TraceHistoryState = {
    seen: new Set(parseSeen(seenRaw)[sessionId] ?? []),
    clearedAt: parseCleared(clearedRaw)[sessionId] ?? null,
    onlyTurn: onlyRaw === 'on',
  }
  cache.delete(sessionId)
  cache.set(sessionId, { raw, state })
  while (cache.size > MAX_SESSIONS) cache.delete(cache.keys().next().value as string)
  return state
}

export const useTraceHistoryState = (sessionId: string): TraceHistoryState =>
  useSyncExternalStore(subscribe, () => readTraceHistoryState(sessionId))

// ---- 写入 ----

export function markSeen(sessionId: string, id: string): void {
  if (!id) return
  const all = parseSeen(readRaw(TRACE_SEEN_KEY))
  const list = all[sessionId] ?? []
  if (list.includes(id)) return
  // 先删再放，让这个会话排到最后（最久没动的在最前面）
  delete all[sessionId]
  all[sessionId] = [...list, id].slice(-MAX_SEEN)
  writeRaw(TRACE_SEEN_KEY, JSON.stringify(capSessions(all)))
  emit()
}

export function clearHistory(sessionId: string, at: number): void {
  const all = parseCleared(readRaw(TRACE_CLEARED_KEY))
  delete all[sessionId]
  all[sessionId] = at
  writeRaw(TRACE_CLEARED_KEY, JSON.stringify(capSessions(all)))
  emit()
}

export function restoreHistory(sessionId: string): void {
  const all = parseCleared(readRaw(TRACE_CLEARED_KEY))
  if (!(sessionId in all)) return
  delete all[sessionId]
  writeRaw(TRACE_CLEARED_KEY, JSON.stringify(all))
  emit()
}

export function setOnlyTurn(on: boolean): void {
  writeRaw(TRACE_ONLY_TURN_KEY, on ? 'on' : 'off')
  emit()
}

export function forgetSessions(ids: readonly string[]): void {
  const seen = parseSeen(readRaw(TRACE_SEEN_KEY))
  const cleared = parseCleared(readRaw(TRACE_CLEARED_KEY))
  let seenChanged = false
  let clearedChanged = false
  for (const id of ids) {
    cache.delete(id)
    if (id in seen) seenChanged = delete seen[id]
    if (id in cleared) clearedChanged = delete cleared[id]
  }
  if (seenChanged) writeRaw(TRACE_SEEN_KEY, JSON.stringify(seen))
  if (clearedChanged) writeRaw(TRACE_CLEARED_KEY, JSON.stringify(cleared))
  if (seenChanged || clearedChanged) emit()
}

// 会话删除 / 归档时一起丢（和 transcriptPlaces 同一个信号）
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function')
  window.addEventListener(SESSION_REMOVED_EVENT, e => {
    forgetSessions((e as CustomEvent<{ ids?: string[] }>).detail?.ids ?? [])
  })
