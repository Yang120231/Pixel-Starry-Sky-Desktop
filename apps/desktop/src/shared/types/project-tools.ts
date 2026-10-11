import type { Item } from '@pixelsky/protocol'

export interface ManualTask {
  id: string
  projectId: string
  title: string
  note: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'low' | 'normal' | 'high'
  due: string
  tags: string[]
  order: number
  createdAt: number
  updatedAt: number
  /** 固定到左侧栏的时间；没固定为 null 或没有（旧数据）（docs/ui/files-search-terminal-pins.md §5） */
  pinnedAt?: number | null
}
export interface AiPlan {
  sessionId: string
  title: string
  item: Extract<Item, { kind: 'todo' }>
}
export interface TaskState {
  tasks: ManualTask[]
  plans: AiPlan[]
}
export interface ServiceDefinition {
  id: string
  projectId: string
  workspacePath: string
  name: string
  command: string
  cwd: string
  port: number | null
  healthUrl: string | null
  envNames: string[]
  autoStart: boolean
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed'
  pid: number | null
  output: string
  error: string | null
  exitCode: number | null
  updatedAt: number
  health: 'none' | 'checking' | 'healthy' | 'unhealthy'
}
export interface ServiceInput {
  id?: string
  name: string
  command: string
  cwd?: string
  port?: number | null
  healthUrl?: string | null
  envNames?: string[]
  autoStart?: boolean
}
export interface ToolStatus {
  name: string
  version: string | null
  path: string | null
  expected: string | null
  status: 'ready' | 'missing' | 'error' | 'mismatch' | 'unknown'
  checkedAt: number
}
export interface EnvironmentState {
  projectId: string
  projectPath: string
  gitRoot: string | null
  branch: string | null
  commit: string | null
  dirty: boolean
  tools: ToolStatus[]
  services: ServiceDefinition[]
  checkedAt: number
  scripts: Record<string, string>
  /** 运行脚本用的包管理器（packageManager 字段或锁文件判断；旧远端没有这个字段） */
  packageManager?: import('@pixelsky/protocol').PackageManager
}
export interface ProjectCopy {
  id: string
  projectId: string
  name: string
  path: string
  branch: string
  baseCommit: string
  baseBranch: string
  createdAt: number
  updatedAt: number
  dirty: boolean
  changedCount: number
  ahead: number
  behind: number
  sessions: { id: string; title: string; state: string }[]
  error: string | null
}
export interface CopyInput {
  name: string
  branch: string
  existingBranch: boolean
  base: string
  directory?: string
}
export interface CopyPreview {
  input: CopyInput
  path: string
  commit: string
  branch: string
  root: string
}
// ---------------------------------------------------------------------------
// Git 面板（docs/ui/git-panel.md）
// ---------------------------------------------------------------------------
export type GitCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?'
export type GitArea = 'staged' | 'unstaged' | 'untracked' | 'conflicted'
export interface GitFileChange {
  /** 相对仓库根目录，用 / 分隔 */
  path: string
  /** 改名 / 复制前的路径 */
  origPath: string | null
  code: GitCode
  /** 相对当前工作区的路径（可以在编辑器中打开）；文件不在工作区子目录内时为 null */
  local: string | null
  submodule: boolean
}
export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'
export interface GitStatus {
  repo: boolean
  /** 没有找到 git 程序 */
  missing: boolean
  root: string | null
  branch: string | null
  detached: boolean
  /** 当前提交（完整 hash）；还没有提交时为 null */
  head: string | null
  /** 还没有任何提交 */
  initial: boolean
  upstream: string | null
  ahead: number
  behind: number
  remotes: string[]
  staged: GitFileChange[]
  unstaged: GitFileChange[]
  untracked: GitFileChange[]
  conflicted: GitFileChange[]
  /** 改动太多，只列出了前 5000 项 */
  truncated: boolean
  operation: GitOperation | null
  /** 最近一次检查远端的时间（FETCH_HEAD 的修改时间） */
  fetchedAt: number | null
  /** 在这个工作区运行中的会话数 */
  busySessions: number
}
/** 差异：工作区的四组；或历史里两个提交之间的一个文件（from 为 null 是根提交） */
export type GitDiffInput =
  | { path: string; area: GitArea; origPath?: string | null }
  | { path: string; area: 'commit'; origPath?: string | null; from: string | null; to: string }
export interface GitDiff {
  path: string
  original: string | null
  modified: string | null
  binary: boolean
  tooLarge: boolean
}
export interface GitBranch {
  name: string
  remote: boolean
  upstream: string | null
  current: boolean
  /** 被副本（worktree）占用时的目录 */ worktree: string | null
  committedAt: number
}
export type GitFailureKind =
  | 'diverged'
  | 'rejected'
  | 'conflict'
  | 'auth'
  | 'network'
  | 'timeout'
  | 'locked'
  | 'hook'
  | 'dirty'
  | 'noUpstream'
  | 'noRemote'
  | 'identity'
  | 'nothing'
  | 'worktree'
  | 'unmerged'
  | 'busy'
  | 'missing'
  | 'notRepo'
  | 'invalid'
  | 'unknown'
export type GitRemedy = 'retry' | 'pullRebase' | 'pullStash' | 'publish' | 'abort' | 'terminal'
export type GitAction =
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'commit'
  | 'pull'
  | 'push'
  | 'fetch'
  | 'switch'
  | 'create'
  | 'operation'
  | 'history'
export interface GitFailure {
  kind: GitFailureKind
  action: GitAction
  /** git 的原始输出末尾（最多 4000 字） */ detail: string
  remedies: GitRemedy[]
}
export type GitResult = { ok: true; status: GitStatus } | { ok: false; failure: GitFailure; status: GitStatus | null }
export type GitPaths = string[] | 'all'
export type GitPullMode = 'ff-only' | 'rebase' | 'stash'

// 提交历史（docs/ui/git-panel.md §9）
/** 提交上的引用标记：head 是分离 HEAD；branch 的 current 表示 HEAD 指向它 */
export interface GitRefLabel {
  kind: 'head' | 'branch' | 'remote' | 'tag'
  /** 短名：main、origin/main、v1.0 */
  name: string
  current?: boolean
}
export interface GitCommit {
  hash: string
  parents: string[]
  author: string
  email: string
  /** 毫秒 */
  authoredAt: number
  committedAt: number
  subject: string
  /** 第一行以外的提交信息 */
  body: string
  refs: GitRefLabel[]
  /** 改动统计（合并提交按第一父提交算；旧版 git 不支持时为 null） */
  stat: { files: number; insertions: number; deletions: number } | null
}
/** auto：当前分支 + 上游 + 基础分支；all：全部分支和标签；数组：自选的引用（短名） */
export type GitLogScope = 'auto' | 'all' | string[]
export interface GitLogQuery {
  scope: GitLogScope
  /** 按提交信息、作者、哈希前缀搜索；有搜索词时按提交时间排，没有分支线 */
  search?: string
  skip: number
  limit: number
}
export interface GitLogPage {
  commits: GitCommit[]
  /** 还有更多 */
  more: boolean
  /** 浅克隆：更早的历史没有下载 */
  shallow: boolean
}
export interface GitRefs {
  /** 当前提交；还没有提交时为 null */
  head: string | null
  branch: string | null
  upstream: string | null
  /** 基础分支（main / master / 远端默认分支），当前就在它上面或找不到时为 null */
  base: string | null
  local: string[]
  remote: string[]
  tags: string[]
}
export type GitCommitCode = 'A' | 'M' | 'D' | 'R' | 'C' | 'T'
export interface GitCommitFile {
  path: string
  origPath: string | null
  code: GitCommitCode
  /** 二进制文件为 null */
  insertions: number | null
  deletions: number | null
}
/** 两个提交之间的改动：一个提交的详情（from = 第一父提交）、未拉取 / 未推送、相对基础分支 */
export interface GitChangeSet {
  /** 比较的起点；根提交为 null（和空树比） */
  from: string | null
  to: string
  files: GitCommitFile[]
  /** 文件太多，只列出了前 5000 个 */
  truncated: boolean
}
export interface GitCommitDetail extends GitChangeSet {
  commit: GitCommit
}
/** outgoing：未推送（上游 → HEAD）；incoming：未拉取（HEAD → 上游）；base：本分支相对基础分支 */
export type GitCompareKind = 'outgoing' | 'incoming' | 'base'
/** 比较：上面三种，或任意两个提交 / 引用（from、to 是哈希或已有引用的短名，§9.6 第二期） */
export type GitCompareTarget = GitCompareKind | { from: string; to: string }
/** 历史里会改动仓库的操作（docs/ui/git-panel.md §9.6 第二期）；检出分支沿用 gitSwitch */
export type GitHistoryAction =
  | { kind: 'checkout' | 'cherryPick' | 'revert'; hash: string }
  | { kind: 'reset'; hash: string; mode: 'soft' | 'mixed' | 'hard' }
  | { kind: 'tag'; hash: string; name: string; message?: string }
  | { kind: 'deleteBranch'; name: string; force?: boolean }
  | { kind: 'deleteTag'; name: string }
export interface GitCompareResult extends GitChangeSet {
  /** 涉及的提交数 */
  commits: number
}
