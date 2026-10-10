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
