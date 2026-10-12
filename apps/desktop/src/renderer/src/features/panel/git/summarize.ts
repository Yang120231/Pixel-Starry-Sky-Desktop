// 从 Git 状态算出顶栏和新任务起点要的摘要（docs/ui/workbench-ux-3.md §2.1）；纯函数，状态缓存在 ./summary.ts
import type { GitStatus } from '../../../../../shared/types/project-tools'

export interface GitSummary {
  branch: string | null
  detached: boolean
  head: string | null
  /** 有改动的文件数（暂存、未暂存、未跟踪、冲突，同一个文件只算一次） */
  changed: number
}

export function summarize(status: GitStatus): GitSummary | null {
  if (!status.repo) return null
  const paths = new Set(
    [...status.staged, ...status.unstaged, ...status.untracked, ...status.conflicted].map(c => c.path),
  )
  return { branch: status.branch, detached: status.detached, head: status.head, changed: paths.size }
}

/** 顶栏切换分支前（docs/ui/context-settings-branch-switch.md §3.2）：AI 在运行时拒绝；有改动时先确认；否则直接切 */
export type SwitchCheck = { kind: 'busy' } | { kind: 'confirm'; changed: number } | { kind: 'go' }

export function beforeSwitch(status: GitStatus): SwitchCheck {
  if (status.busySessions > 0) return { kind: 'busy' }
  const changed = summarize(status)?.changed ?? 0
  return changed > 0 ? { kind: 'confirm', changed } : { kind: 'go' }
}
