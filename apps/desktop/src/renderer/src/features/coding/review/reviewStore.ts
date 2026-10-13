// 逐块审查的状态：只在内存里。scope = `${sessionId}:${turnKey}:${path}`
import { useSyncExternalStore } from 'react'
import type { ReviewHunk } from './hunksModel'

const EMPTY: ReadonlySet<string> = new Set()
const reviewed = new Map<string, ReadonlySet<string>>()
const turns = new Set<string>()
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach(l => l())
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function markReviewed(scope: string, keys: readonly string[]): void {
  if (!keys.length) return
  const next = new Set(reviewed.get(scope) ?? EMPTY)
  for (const key of keys) next.add(key)
  reviewed.set(scope, next)
  emit()
}
/** 整轮标记：这一轮所有文件的所有块都算已审查 */
export function markTurnReviewed(sessionId: string, turnKey: string): void {
  turns.add(`${sessionId}:${turnKey}:`)
  emit()
}
/** 这一轮是不是已经整轮标记过（改动卡片上的「全部保留」点过就不再显示） */
export function useTurnReviewed(sessionId: string | null, turnKey: string): boolean {
  return useSyncExternalStore(subscribe, () => !!sessionId && turns.has(`${sessionId}:${turnKey}:`))
}
function reviewedOf(scope: string): ReadonlySet<string> | 'all' {
  for (const prefix of turns) if (scope.startsWith(prefix)) return 'all'
  return reviewed.get(scope) ?? EMPTY
}
export function useReviewed(scope: string | null): ReadonlySet<string> | 'all' {
  return useSyncExternalStore(subscribe, () => (scope ? reviewedOf(scope) : EMPTY))
}

// ---------------------------------------------------------------------------
// 编辑器里的实时状态：扩展（CodeMirror 插件）发布，AiReviewBar 订阅
// ---------------------------------------------------------------------------
export interface ReviewLive {
  /** 发布者（扩展实例）的标识，销毁时只清自己的 */
  owner: object
  scope: string
  /** 还没审查的块 */
  hunks: readonly ReviewHunk[]
  tooBig: boolean
  /** 这个 scope 里撤销过的块数 */
  undone: number
}
const live = new Map<string, ReviewLive>()
const NO_LIVE: ReviewLive | null = null

export function publishLive(tabId: string, info: Omit<ReviewLive, 'undone'>): void {
  const prev = live.get(tabId)
  const undone = prev && prev.scope === info.scope ? prev.undone : 0
  if (prev && prev.owner === info.owner && prev.hunks === info.hunks && prev.tooBig === info.tooBig) return
  live.set(tabId, { ...info, undone })
  emit()
}
export function clearLive(tabId: string, owner: object): void {
  if (live.get(tabId)?.owner !== owner) return
  live.delete(tabId)
  emit()
}
export function addUndone(tabId: string, n: number): void {
  const prev = live.get(tabId)
  if (!prev) return
  live.set(tabId, { ...prev, undone: prev.undone + n })
  emit()
}
export function useLive(tabId: string): ReviewLive | null {
  return useSyncExternalStore(subscribe, () => live.get(tabId) ?? NO_LIVE)
}
