// 从文件树、改动列表等地方打开某个文件的 Git 历史（docs/ui/git-panel.md §9.15）：先打开 Git 页，
// 显示同一个工作区的 Git 页（GitBody）收到后切到「历史」并只列这个文件的提交。
import { tr } from '@/i18n/core'
import { getEngineState } from '@/features/engine/store'
import { notify } from '@/features/panes/store'
import type { WorkspaceRef } from '../../../../../shared/types/workspace'
import { openRightTab } from '../workspaceStore'

export interface FileHistoryRequest {
  ref: WorkspaceRef
  path: string
  /** path 相对工作区（文件树）还是仓库根目录（提交里的文件） */
  base: 'workspace' | 'repo'
}

export const FILE_HISTORY_EVENT = 'pixelsky:git-file-history'
let pending: FileHistoryRequest | null = null

const projectOf = (ref: WorkspaceRef): string | null =>
  ref.projectId ?? getEngineState().sessions.find(s => s.record.id === ref.sessionId)?.record.projectId ?? null

/** 同一个工作区，或者会话属于同一个项目（会话可能在副本里，历史相同） */
export function sameWorkspace(a: WorkspaceRef, b: WorkspaceRef): boolean {
  if (a.sessionId && a.sessionId === b.sessionId) return true
  if (!a.sessionId && !b.sessionId) return a.projectId === b.projectId
  const p = projectOf(a)
  return !!p && p === projectOf(b)
}

export function requestFileHistory(request: FileHistoryRequest): void {
  pending = request
  openRightTab('git')
  window.dispatchEvent(new Event(FILE_HISTORY_EVENT))
  // Git 页显示的是别的项目时没人接：提示一下
  window.setTimeout(() => {
    if (pending === request) {
      pending = null
      notify(tr('git.history.file.otherProject'))
    }
  }, 1500)
}

/** Git 页取走发给自己的请求 */
export function takeFileHistory(target: WorkspaceRef, demo: boolean): FileHistoryRequest | null {
  if (!pending || !(demo || sameWorkspace(pending.ref, target))) return null
  const request = pending
  pending = null
  return request
}
