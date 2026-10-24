// 开分支 / 合并回主会话（docs/ui/branch-merge.md）：开着哪个弹窗。侧栏右键、分支名下拉、消息按钮、分支横条都经这里打开
import { useSyncExternalStore } from 'react'
import { ENGINES, type SessionRecord } from '@pixelsky/protocol'
import type { TranslationKey } from '@/i18n/core'
import { getEngineState } from '@/features/engine/store'

export type BranchDialogState =
  /** itemId 为 null：带上整个会话；mode 是弹窗里「代码」默认选哪个 */
  | { kind: 'branch'; sessionId: string; itemId: string | null; mode: 'copy' | 'shared' }
  | { kind: 'merge'; sessionId: string }
  | null

let state: BranchDialogState = null
const listeners = new Set<() => void>()

function set(next: BranchDialogState): void {
  state = next
  listeners.forEach(fn => fn())
}

export function openBranchDialog(
  sessionId: string,
  itemId: string | null = null,
  mode: 'copy' | 'shared' = 'copy',
): void {
  set({ kind: 'branch', sessionId, itemId, mode })
}

export function openMergeDialog(sessionId: string): void {
  set({ kind: 'merge', sessionId })
}

export function closeBranchDialog(): void {
  set(null)
}

export function useBranchDialog(): BranchDialogState {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}

/** 会话记录：打开过的取快照里的（最新），没打开过的取列表里的 */
export function sessionRecord(id: string): SessionRecord | null {
  const s = getEngineState()
  return s.snapshots[id]?.record ?? s.sessions.find(x => x.record.id === id)?.record ?? null
}

/** AI 正在回复（或队列里有正在发的） */
export function sessionBusy(id: string): boolean {
  const s = getEngineState()
  const snap = s.snapshots[id]
  if (snap)
    return snap.state !== 'idle' || snap.queue.some(q => ['dispatching', 'running', 'delivering'].includes(q.status))
  return (s.sessions.find(x => x.record.id === id)?.state ?? 'idle') !== 'idle'
}

/** 引擎能分叉才能开分支（像素引擎不能） */
export function canBranch(record: SessionRecord | null | undefined): boolean {
  return !!record && ENGINES[record.engine]?.caps.fork === true
}

/** 开分支开出来、上级还在 */
export function branchParent(record: SessionRecord | null | undefined): SessionRecord | null {
  if (!record?.branch || !record.forkedFrom) return null
  return sessionRecord(record.forkedFrom.sessionId)
}

/** 合并目标叫「主会话」还是「上级会话」：上级自己也是分支时叫上级 */
export function parentIsBranch(record: SessionRecord | null | undefined): boolean {
  return !!branchParent(branchParent(record))
}

/** 副本删了：只能回看 */
export function branchReadOnly(record: SessionRecord | null | undefined): boolean {
  return !!record?.branch?.copyRemoved
}

/** 合并按钮的文字 */
export function mergeLabel(record: SessionRecord, place: 'menu' | 'banner'): TranslationKey {
  if (record.branch?.mergedAt) return place === 'menu' ? 'branch.menu.remerge' : 'branch.banner.remerge'
  const up = parentIsBranch(record)
  if (place === 'menu') return up ? 'branch.menu.mergeParent' : 'branch.menu.mergeMain'
  return up ? 'branch.banner.mergeParent' : 'branch.banner.mergeMain'
}
