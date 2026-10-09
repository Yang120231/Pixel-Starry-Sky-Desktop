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
export interface GitFailure {
  kind: GitFailureKind
  action: GitAction
  /** git 的原始输出末尾（最多 4000 字） */ detail: string
  remedies: GitRemedy[]
}
export type GitResult = { ok: true; status: GitStatus } | { ok: false; failure: GitFailure; status: GitStatus | null }
export type GitPaths = string[] | 'all'
export type GitPullMode = 'ff-only' | 'rebase' | 'stash'
