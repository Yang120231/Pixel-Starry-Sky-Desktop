// 对话里的工具行和下面的审批互相定位（docs/ui/approval-stack.md §2 ⑦）：
// 点对话里「等你决定」跳到对应那一项；选中审批里的一行时，对话里那一行轻微高亮
import { createContext, useContext, useSyncExternalStore } from 'react'

interface State {
  /** 要跳到的审批：每点一次 token 加一，同一项也能再跳 */
  locate: { sessionId: string; requestId: string; token: number } | null
  /** 审批里选中的那一项对应的工具条目 */
  selected: { sessionId: string; itemId: string } | null
}

let state: State = { locate: null, selected: null }
const listeners = new Set<() => void>()
const set = (next: Partial<State>): void => {
  state = { ...state, ...next }
  for (const l of listeners) l()
}
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function locateApproval(sessionId: string, requestId: string): void {
  set({ locate: { sessionId, requestId, token: (state.locate?.token ?? 0) + 1 } })
}

export function selectApprovalItem(sessionId: string, itemId: string | null): void {
  const current = state.selected
  if (
    itemId === null ? current?.sessionId !== sessionId : current?.sessionId === sessionId && current.itemId === itemId
  )
    return
  set({ selected: itemId === null ? null : { sessionId, itemId } })
}

/** 这个会话最近一次「跳到审批」的请求 */
export function useApprovalLocate(sessionId: string): State['locate'] {
  const locate = useSyncExternalStore(
    subscribe,
    () => state.locate,
    () => null,
  )
  return locate?.sessionId === sessionId ? locate : null
}

/** 这个会话里审批选中的工具条目 id */
export function useSelectedApprovalItem(sessionId: string | null): string | null {
  const selected = useSyncExternalStore(
    subscribe,
    () => state.selected,
    () => null,
  )
  return sessionId && selected?.sessionId === sessionId ? selected.itemId : null
}

/** 对话区知道哪些工具条目在等审批（工具条目 id → 审批请求 id） */
export interface ApprovalWaitValue {
  sessionId: string
  byItem: ReadonlyMap<string, string>
}
export const ApprovalWaitContext = createContext<ApprovalWaitValue | null>(null)

/** 这个工具条目在等审批时返回会话和请求 id */
export function useApprovalWait(itemId: string): { sessionId: string; requestId: string } | null {
  const value = useContext(ApprovalWaitContext)
  const requestId = value?.byItem.get(itemId)
  return value && requestId ? { sessionId: value.sessionId, requestId } : null
}
