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
  /** 改成已完成的时间；没完成为 null，旧数据没有（任务看板「已完成」按它算最近 7 天，没有时用 updatedAt） */
  completedAt?: number | null
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
/** 代码模式左栏「任务」：项目里能跑的命令（docs/ui/coding-tasks.md §2）。只读文件得到，不执行命令 */
export type RunTaskKind = 'npm' | 'make' | 'cargo' | 'gradle' | 'ext'
export interface RunTask {
  /** 组内唯一：任务名 */
  name: string
  /** 灰字：npm 是脚本内容，make 空，cargo 是完整命令；gradle 是构建文件里写的 description，按插件推断的为空（界面上换成内置说明） */
  detail: string
  /** 在文件里的行号（1 起）；不知道时 null */
  line: number | null
  /** gradle：任务分组（Gradle 的 group，小写，如 build、verification、fabric；没写的是 other） */
  category?: string
  /** gradle：完整任务列表里 Gradle 给的说明（多是英文）；界面上排在 detail 和内置说明后面 */
  description?: string
  /** ext：扩展模板给的说明（多语言文本，界面按当前语言取） */
  extDetail?: import('@pixelsky/protocol').ExtText
}
/** gradle.properties 的一项（docs/ui/coding-tasks.md §9） */
export interface GradleProperty {
  key: string
  /** secret 时为空串，不把值传出主进程 */
  value: string
  line: number
  /** 键名像密码 / token（含 pass、secret、token、key、credential），界面显示成 •••• */
  secret: boolean
}
/** gradle 组（一个 Gradle 项目）的附加信息 */
export interface RunTaskGradle {
  /** 构建根目录（settings.gradle 所在；没有 settings 时是 build.gradle 所在），相对工作区根（posix），根是 '' */
  buildDir: string
  /** 项目路径：根项目 ':'，子项目 ':fabric'、':libs:core' */
  project: string
  /** 显示名：根项目是 rootProject.name（没写用文件夹名），子项目是项目路径 */
  name: string
  /** 构建根目录下有 gradlew / gradlew.bat */
  wrapper: boolean
  /** 同一个构建所有文件内容的指纹（settings、各 build 文件、gradle.properties、wrapper 配置），完整任务列表用它判断是否过期 */
  stamp: string
  /** 认出的主插件显示名，如 'Fabric Loom'、'ModDevGradle'、'Spring Boot'、'java' */
  plugin: string | null
  /** 只在根项目：gradle-wrapper.properties 里的 Gradle 版本 */
  gradleVersion?: string | null
  /** 只在根项目：toolchain / sourceCompatibility / jvmToolchain 等写的 Java 版本 */
  javaVersion?: string | null
  /** 只在根项目：gradle.properties（最多 100 项） */
  properties?: GradleProperty[]
}
/** 扩展任务模板产生的组的附加信息（docs/extensions/authoring-spec.md §8） */
export interface RunTaskExt {
  packKey: string
  packId: string
  templateId: string
  label: import('@pixelsky/protocol').ExtText
  /** 扩展里的图标路径 */
  icon?: string
  /** 命令模板，含 {name} {runner} {dir} {file} */
  command: string
  /** 工作目录模板，默认 {dir} */
  cwd: string
  /** 选中的运行器；模板没写 runner 时为 null */
  runner: string | null
  /** 运行器是项目里的文件（要加 ./ 或 .\ 前缀） */
  runnerLocal: boolean
}
export interface RunTaskGroup {
  kind: RunTaskKind
  /** 文件相对工作区根目录的路径（posix），如 `package.json`、`apps/desktop/package.json`；gradle 是 build.gradle(.kts)，根项目没有时是 settings 文件 */
  file: string
  /** 文件所在文件夹（posix），根目录是 '' */
  dir: string
  /** npm 组用哪个包管理器 */
  manager?: import('@pixelsky/protocol').PackageManager
  /** gradle 组的附加信息 */
  gradle?: RunTaskGradle
  /** ext 组（扩展的任务模板）的附加信息 */
  ext?: RunTaskExt
  tasks: RunTask[]
}
/** `gradlew tasks --all` 读出的一个任务（「加载完整列表」） */
export interface GradleListedTask {
  /** 项目路径：根项目 ':'，子项目 ':fabric' */
  project: string
  name: string
  category: string
  description: string
}
export interface RunTaskState {
  /** 工作区根目录（绝对路径） */
  root: string
  groups: RunTaskGroup[]
  /** 文件太多，只读了前 30 个 */
  truncated: boolean
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
  /** 改动统计（合并提交按第一父提交算；旧版 git 不支持时、单文件历史里为 null） */
  stat: { files: number; insertions: number; deletions: number } | null
  /** 单文件历史（§9.15）：这个文件在这个提交里的路径、状态和增删行数（改过名时 origPath 是改名前） */
  file?: GitCommitFile
}
/** auto：当前分支 + 上游 + 基础分支；all：全部分支和标签；数组：自选的引用（短名） */
export type GitLogScope = 'auto' | 'all' | string[]
export interface GitLogQuery {
  scope: GitLogScope
  /** 按提交信息、作者、哈希前缀搜索；有搜索词时按提交时间排，没有分支线 */
  search?: string
  /** 单文件历史（§9.15）：只列改过这个文件的提交，跟着改名往前找；没有分支线 */
  path?: string
  /** path 相对哪里：工作区（文件树）或仓库根目录（提交里的文件），默认工作区 */
  pathBase?: 'workspace' | 'repo'
  skip: number
  limit: number
}
export interface GitLogPage {
  commits: GitCommit[]
  /** 还有更多 */
  more: boolean
  /** 浅克隆：更早的历史没有下载 */
  shallow: boolean
  /** 单文件历史查的路径（相对仓库根目录） */
  path?: string
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
  /** 这个文件现在在工作区里的路径（相对工作区，可直接打开）；在工作区外、这次删掉的、后来删掉或改名的为 null */
  local?: string | null
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
/** AI 写提交信息要提交的范围：有暂存只看暂存；all 是全部改动（含未跟踪），和「提交全部」一致 */
export type GitCommitScope = 'staged' | 'all'
/**
 * 一个文件的改动放进去了多少（docs/ui/ai-commit-codex-warnings-history.md §2.2）：
 * diff 全部；cut 太长只放了开头；listed 锁文件 / 压缩文件只列名字；secret 可能有密钥，连改动行都不发；
 * binary 二进制；omitted 超出总上限或拆不出这个文件的正文
 */
export type GitContextContent = 'diff' | 'cut' | 'listed' | 'secret' | 'binary' | 'omitted'
export interface GitContextFile extends GitCommitFile {
  content: GitContextContent
}
export interface GitCommitContext {
  scope: GitCommitScope
  /** 当前分支；分离 HEAD 时为 null */
  branch: string | null
  files: GitContextFile[]
  /** 放进去的改动正文（unified diff，上下文 3 行），按文件顺序 */
  patch: string
  /** 最近的提交标题，新的在前（不含合并提交）；还没有提交时为空 */
  recent: string[]
  /** 文件太多，只列出了前一部分 */
  truncated: boolean
}
