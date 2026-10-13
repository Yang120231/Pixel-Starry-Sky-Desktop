// 哪些标签的内容保持挂载（docs/ui/renderer-memory.md §3.3，D123）：
// 每个窗格的当前标签 + 最近用过的几个对话标签；新对话、文件标签总是挂着；等你审批 / 回答提问的对话标签不卸载也不占名额
// （提问卡片填到一半的草稿是组件自己的状态，卸载就丢）。其余对话标签卸载成空占位，标签头照常显示。
import { useRef, useSyncExternalStore } from 'react'
import { useEngineState } from '@/features/engine/store'
import { isFileTab, isNewTab, type Leaf } from './tree'

/** 每个窗格除当前标签外保留几个最近用过的对话标签 */
export const DEFAULT_KEEP_ALIVE = 2

let limit = DEFAULT_KEEP_ALIVE
const listeners = new Set<() => void>()

/** 轻量模式（崩溃恢复后）改成 0：切走的对话标签一律卸载；退出轻量模式改回 DEFAULT_KEEP_ALIVE */
export function setKeepAliveLimit(next: number): void {
  next = Math.max(0, Math.floor(next))
  if (next === limit) return
  limit = next
  listeners.forEach(l => l())
}

export const getKeepAliveLimit = (): number => limit

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 当前保活个数（可订阅） */
export const useKeepAliveLimit = (): number =>
  useSyncExternalStore(subscribe, getKeepAliveLimit, () => DEFAULT_KEEP_ALIVE)

export const isSessionTab = (tab: string): boolean => !isNewTab(tab) && !isFileTab(tab)

/**
 * 要保持挂载的标签：每个窗格取当前标签、新对话和文件标签、pinned 的对话标签，
 * 再按 recency（越大越近）从新到旧取 limit 个对话标签
 */
export function keepMounted(
  leaves: readonly Leaf[],
  recency: ReadonlyMap<string, number>,
  opts: { limit: number; isSession: (tab: string) => boolean; pinned: (tab: string) => boolean },
): Set<string> {
  const keep = new Set<string>()
  for (const leaf of leaves) {
    const others: string[] = []
    for (const tab of leaf.tabs) {
      if (tab === leaf.active || !opts.isSession(tab) || opts.pinned(tab)) keep.add(tab)
      else others.push(tab)
    }
    others
      .filter(tab => recency.has(tab))
      .sort((a, b) => (recency.get(b) ?? 0) - (recency.get(a) ?? 0))
      .slice(0, Math.max(0, opts.limit))
      .forEach(tab => keep.add(tab))
  }
  return keep
}

/** 等你处理的会话 id（拼成一个字符串，选择器返回新数组会让订阅一直重渲染） */
function waitingKey(s: {
  sessions: Array<{ record: { id: string }; state: string }>
  snapshots: Record<string, { pending: unknown[] }>
}): string {
  const ids = new Set<string>()
  for (const x of s.sessions) if (x.state === 'waiting') ids.add(x.record.id)
  for (const [id, snap] of Object.entries(s.snapshots)) if (snap.pending.length > 0) ids.add(id)
  return [...ids].sort().join('\n')
}

// 挂着内容的标签（内存遥测用）
let mounted = 0
export const mountedTabCount = (): number => mounted
export function noteMounted(): () => void {
  mounted++
  return () => void mounted--
}

/** 丢掉已经不在任何窗格里的标签（关掉的标签不再占着记录） */
export function pruneRecency(recency: Map<string, number>, leaves: readonly Leaf[]): void {
  if (!recency.size) return
  const alive = new Set(leaves.flatMap(leaf => leaf.tabs))
  for (const tab of recency.keys()) if (!alive.has(tab)) recency.delete(tab)
}

/**
 * 算要保持挂载的标签。「最近用过」按标签最后一次成为窗格当前标签的先后，只记在内存里，启动时为空：
 * 启动只挂每个窗格的当前标签，其余恢复的标签等切过去再挂
 */
export function useKeepMounted(leaves: readonly Leaf[]): Set<string> {
  const limit = useKeepAliveLimit()
  const waiting = useEngineState(waitingKey)
  const recency = useRef(new Map<string, number>())
  const seen = useRef(new Map<string, string | null>())
  const seq = useRef(0)
  // 渲染时同步更新：只在当前标签变了才记一个新序号，重复渲染（StrictMode）不会重复记
  for (const leaf of leaves) {
    if (seen.current.get(leaf.id) === leaf.active) continue
    seen.current.set(leaf.id, leaf.active)
    if (leaf.active) recency.current.set(leaf.active, ++seq.current)
  }
  pruneRecency(recency.current, leaves)
  const pinned = new Set(waiting ? waiting.split('\n') : [])
  return keepMounted(leaves, recency.current, { limit, isSession: isSessionTab, pinned: tab => pinned.has(tab) })
}
