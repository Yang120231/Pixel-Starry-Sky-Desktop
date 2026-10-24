// 开分支 / 合并回主会话（docs/ui/branch-merge.md §6）：主进程和界面共用的类型

/** 开分支前弹窗要的信息（engine:branchPrepare） */
export interface BranchPrepare {
  /** 工作目录在 Git 仓库里：能建副本 */
  git: boolean
  /** 当前所在的分支；分离头指针时为 null */
  baseBranch: string | null
  /** 没提交的改动（含新文件）有几个 */
  dirty: number
  /** 默认副本目录的上一级（副本目录 = 它 + 副本名） */
  copyRoot: string | null
  /** 已有的本地分支名（弹窗里查重名） */
  branches: string[]
  /** 已有的副本名（查重名） */
  copies: string[]
}

export interface BranchCreateInput {
  title: string
  /** null：和上级同一个目录（只分开对话） */
  copy: { name: string; branch: string; carry: boolean } | null
}

export type BranchFileMerge = 'replace' | 'auto' | 'conflict'

export interface BranchFile {
  path: string
  status: 'added' | 'modified' | 'deleted'
  additions: number | null
  deletions: number | null
  /** 写回上级的办法：replace 直接换成分支的版本、auto 三方自动合并、conflict 合不了 */
  merge: BranchFileMerge
  /** 合不了的原因（conflict 时） */
  reason?: 'conflict' | 'binary' | 'deleted' | 'removedThere' | 'addedBoth'
}

/** 合并前的检查（engine:branchStatus） */
export interface BranchStatus {
  mode: 'copy' | 'shared'
  parentId: string
  parentTitle: string
  /** 上级的上级还在：合并目标叫「上级会话」，否则叫「主会话」 */
  parentIsBranch: boolean
  gitBranch: string | null
  /** 上级目录现在所在的分支 */
  parentBranch: string | null
  /** 副本还在（同目录时为 true） */
  copyExists: boolean
  files: BranchFile[]
  conflicts: number
  /** 能压成一个提交：没有冲突，这些文件在上级目录里原来也没有没提交的改动 */
  canCommit: boolean
  /** 在上级目录里有没提交改动的文件（不能压成一个提交的原因） */
  dirtyThere: string[]
  /** 有会话在跑：不能合并 */
  running: 'self' | 'parent' | null
  /** 之前合并过 */
  mergedAt: number | null
}

export interface BranchMergeOptions {
  /** null：不合并代码 */
  code: { commit: boolean; message: string } | null
  removeCopy: boolean
  /** null：不带回摘要 */
  summary: string | null
}

export interface BranchMergeResult {
  code: 'committed' | 'applied' | 'none' | 'skipped'
  files: number
  /** 代码已写进上级目录，但提交没成功 */
  commitError?: string
  /** 合并成功了，但副本或分支没删掉 */
  removeError?: string
}

export interface BranchSummaryResult {
  text: string
  /** false：AI 没写成，用的是整理好的草稿 */
  ai: boolean
  problem?: string
}
