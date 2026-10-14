// 「任务」视图的纯逻辑：拼命令、跑完退出的后缀、状态推导、筛选。不碰 window / localStorage（docs/ui/coding-tasks.md §3、§4）
import type { RunTask, RunTaskGroup, RunTaskState } from '../../../../../shared/types/project-tools'
import type { TerminalRecord } from '../../../../../shared/types/terminal'

/** 目录带空格或引号时加双引号 */
function quoteDir(dir: string): string {
  return /[\s"]/.test(dir) ? `"${dir.replaceAll('"', '\\"')}"` : dir
}

/** 在终端里跑这个任务的命令；子文件夹用工具自己的目录参数，不 cd，和终端种类无关 */
export function taskCommand(group: RunTaskGroup, task: RunTask): string {
  const dir = group.dir
  if (group.kind === 'make') return dir ? `make -C ${quoteDir(dir)} ${task.name}` : `make ${task.name}`
  if (group.kind === 'cargo')
    return dir ? `cargo ${task.name} --manifest-path ${quoteDir(`${dir}/Cargo.toml`)}` : `cargo ${task.name}`
  const manager = group.manager ?? 'npm'
  if (!dir) return `${manager} run ${task.name}`
  const flag = manager === 'pnpm' ? '--dir' : manager === 'npm' ? '--prefix' : '--cwd'
  return `${manager} ${flag} ${quoteDir(dir)} run ${task.name}`
}

/** 终端程序的名字：去掉目录和 .exe，小写 */
export function shellName(program: string | undefined): string {
  const base = (program ?? '').replaceAll('\\', '/').split('/').pop() ?? ''
  return base.toLowerCase().replace(/\.exe$/, '')
}

/** 命令后面接的「跑完就退出、带上命令的退出码」；程序名不认识（含远程）时按 POSIX shell 处理 */
export function exitSuffix(program: string | undefined): string {
  const name = shellName(program)
  if (name === 'powershell' || name === 'pwsh') return '; exit $LASTEXITCODE'
  if (name === 'cmd') return ' && exit 0 || exit 1'
  if (name === 'fish') return '; exit $status'
  return '; exit $?'
}

export type TaskStatusKind = 'idle' | 'running' | 'ok' | 'failed' | 'stopped'
export interface TaskStatus {
  kind: TaskStatusKind
  /** 失败时的退出码；不知道为 null */
  code: number | null
}
export const IDLE: TaskStatus = { kind: 'idle', code: null }

/** 终端记录 → 任务状态。stopped 是本地标记（发过 Ctrl+C），压过「终端还在跑」 */
export function taskStatus(record: TerminalRecord | undefined, stopped = false): TaskStatus {
  if (!record) return IDLE
  if (stopped && record.status !== 'exited') return { kind: 'stopped', code: null }
  if (record.status === 'running' || record.status === 'starting') return { kind: 'running', code: null }
  if (record.status === 'exited')
    return record.exitCode === 0 ? { kind: 'ok', code: null } : { kind: 'failed', code: record.exitCode ?? null }
  if (record.status === 'error') return { kind: 'failed', code: null }
  return IDLE
}

/** 任务在内存里的键（同一工作区内唯一） */
export const taskKey = (group: RunTaskGroup, task: RunTask): string => `${group.file}\u0000${task.name}`

/** 按任务名、命令、所在文件夹 / 文件筛选；组里没有任务命中就去掉这一组 */
export function filterGroups(groups: readonly RunTaskGroup[], query: string): RunTaskGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...groups]
  const result: RunTaskGroup[] = []
  for (const group of groups) {
    const place = `${group.dir} ${group.file}`.toLowerCase()
    const tasks = group.tasks.filter(
      t => place.includes(q) || t.name.toLowerCase().includes(q) || t.detail.toLowerCase().includes(q),
    )
    if (tasks.length) result.push({ ...group, tasks })
  }
  return result
}

/** 根目录的组默认展开，其余收起；overrides 是用户手动改过的（true = 收起） */
export function isCollapsed(group: RunTaskGroup, overrides: Readonly<Record<string, boolean>>): boolean {
  return overrides[group.file] ?? group.dir !== ''
}

/** 键盘上下移动用的可见行（组头 + 展开组里的任务）；筛选时全部展开 */
export type TaskRow = { type: 'group'; group: RunTaskGroup } | { type: 'task'; group: RunTaskGroup; task: RunTask }
export function visibleRows(
  groups: readonly RunTaskGroup[],
  overrides: Readonly<Record<string, boolean>>,
  filtering: boolean,
): TaskRow[] {
  const rows: TaskRow[] = []
  for (const group of groups) {
    rows.push({ type: 'group', group })
    if (filtering || !isCollapsed(group, overrides))
      for (const task of group.tasks) rows.push({ type: 'task', group, task })
  }
  return rows
}

/** 组头显示的名字：子文件夹写文件夹，根目录写文件名 */
export const groupTitle = (group: RunTaskGroup): string => (group.dir ? group.dir : group.file)

/** 文件名是不是会产生任务（编辑器保存后要重新读） */
export function isTaskFile(path: string): boolean {
  const name = path.replaceAll('\\', '/').split('/').pop() ?? ''
  return name === 'package.json' || name === 'Cargo.toml' || /^(gnu)?makefile$/i.test(name)
}

/** 编辑器里打开的文件是任务列表里的哪个 npm 组（只有 package.json 加 ▶）；root 是文件所在工作区根目录 */
export function npmGroupForFile(state: RunTaskState | null, root: string, path: string): RunTaskGroup | null {
  if (!state) return null
  const norm = (v: string): string => v.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  if (norm(state.root) !== norm(root)) return null
  const file = norm(path).replace(/^\.\//, '')
  return state.groups.find(g => g.kind === 'npm' && norm(g.file) === file) ?? null
}
