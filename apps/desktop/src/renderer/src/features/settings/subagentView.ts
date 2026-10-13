// 子智能体在对话里怎么显示（docs/ui/subagent-box.md，D128）：小框（默认）/ 展开在执行里（0.3.1 之前的样子），保存在本机，多窗口同步
import { useSyncExternalStore } from 'react'

export type SubagentView = 'box' | 'inline'
export const SUBAGENT_VIEW_KEY = 'pixelsky.subagent-view'
export const DEFAULT_SUBAGENT_VIEW: SubagentView = 'box'

/** 读不懂的值按默认 */
export const parseSubagentView = (value: unknown): SubagentView =>
  value === 'box' || value === 'inline' ? value : DEFAULT_SUBAGENT_VIEW

function read(): SubagentView {
  try {
    return parseSubagentView(localStorage.getItem(SUBAGENT_VIEW_KEY))
  } catch {
    return DEFAULT_SUBAGENT_VIEW
  }
}

let view: SubagentView = typeof window === 'undefined' ? DEFAULT_SUBAGENT_VIEW : read()
const listeners = new Set<() => void>()

export function setSubagentView(next: SubagentView): void {
  if ((next !== 'box' && next !== 'inline') || next === view) return
  view = next
  try {
    localStorage.setItem(SUBAGENT_VIEW_KEY, view)
  } catch {
    /* 存储不可用时，本次仍然生效 */
  }
  listeners.forEach(listener => listener())
}

function onStorage(event: StorageEvent): void {
  if (event.storageArea !== localStorage || (event.key !== SUBAGENT_VIEW_KEY && event.key !== null)) return
  const next = read()
  if (next === view) return
  view = next
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

export function useSubagentView(): SubagentView {
  return useSyncExternalStore(
    subscribe,
    () => view,
    () => DEFAULT_SUBAGENT_VIEW,
  )
}
