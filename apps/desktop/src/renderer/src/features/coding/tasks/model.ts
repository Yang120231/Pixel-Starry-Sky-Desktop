// 「任务」视图的纯逻辑：拼命令、跑完退出的后缀、状态推导、筛选。不碰 window / localStorage（docs/ui/coding-tasks.md §3、§4）
import type {
  GradleListedTask,
  GradleProperty,
  RunTask,
  RunTaskGroup,
  RunTaskState,
} from '../../../../../shared/types/project-tools'
import type { TerminalRecord } from '../../../../../shared/types/terminal'

/** 目录带空格或引号时加双引号 */
function quoteDir(dir: string): string {
  return /[\s"]/.test(dir) ? `"${dir.replaceAll('"', '\\"')}"` : dir
}

/**
 * Gradle 的命令（docs/ui/coding-tasks.md §9.3）：有 wrapper 用 ./gradlew（PowerShell 自己会找 gradlew.bat，cmd 要写 .\gradlew.bat），
 * 构建不在工作区根时加 -p；根项目只写任务名，子项目写全路径
 */
function gradleCommand(group: RunTaskGroup, task: RunTask, shell: string | undefined): string {
  const g = group.gradle!
  const name = shellName(shell)
  let runner = 'gradle'
  if (g.wrapper) {
    const path =
      name === 'cmd'
        ? `.\\${g.buildDir ? g.buildDir.replaceAll('/', '\\') + '\\' : ''}gradlew.bat`
        : `./${g.buildDir ? g.buildDir + '/' : ''}gradlew`
    // PowerShell 里带引号的路径要用 & 才会执行
    runner = /[\s"]/.test(path) ? `${name === 'powershell' || name === 'pwsh' ? '& ' : ''}${quoteDir(path)}` : path
  }
  const dir = g.buildDir ? ` -p ${quoteDir(g.buildDir)}` : ''
  return `${runner}${dir} ${g.project === ':' ? task.name : `${g.project}:${task.name}`}`
}

/** 在终端里跑这个任务的命令；子文件夹用工具自己的目录参数，不 cd。shell 是终端程序（只有 Gradle 在 cmd 里写法不同），不知道时按 PowerShell / sh 都能用的写 */
export function taskCommand(group: RunTaskGroup, task: RunTask, shell?: string): string {
  if (group.kind === 'gradle' && group.gradle) return gradleCommand(group, task, shell)
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

/** 终端名：Gradle 子项目的任务写全路径（:fabric:runClient），其余就是任务名 */
export const taskTitle = (group: RunTaskGroup, task: RunTask): string =>
  group.gradle && group.gradle.project !== ':' ? `${group.gradle.project}:${task.name}` : task.name

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
      t =>
        place.includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.detail.toLowerCase().includes(q) ||
        !!t.category?.toLowerCase().includes(q) ||
        !!t.description?.toLowerCase().includes(q),
    )
    // Gradle 的属性按键和值筛（密的值不参与）
    const properties = group.gradle?.properties?.filter(
      p => p.key.toLowerCase().includes(q) || (!p.secret && p.value.toLowerCase().includes(q)),
    )
    if (tasks.length || properties?.length)
      result.push(group.gradle ? { ...group, tasks, gradle: { ...group.gradle, properties } } : { ...group, tasks })
  }
  return result
}

/** 根目录的组默认展开，其余收起；overrides 是用户手动改过的（true = 收起） */
export function isCollapsed(group: RunTaskGroup, overrides: Readonly<Record<string, boolean>>): boolean {
  return overrides[group.file] ?? group.dir !== ''
}

/** Gradle 里默认收起的分组（§9.3） */
const QUIET_CATEGORIES = new Set([
  'help',
  'other',
  'verification',
  'documentation',
  'publishing',
  'distribution',
  'build setup',
  'ide',
])
/** 「属性」节点当作一个分组，名字不会和 Gradle 的分组重名 */
export const PROPERTIES = '\u0001properties'
/** Gradle 分组 / 属性节点展开状态的键 */
export const categoryKey = (group: RunTaskGroup, category: string): string => `${group.file}\u0000${category}`
export function isCategoryCollapsed(
  group: RunTaskGroup,
  category: string,
  overrides: Readonly<Record<string, boolean>>,
): boolean {
  return overrides[categoryKey(group, category)] ?? (category === PROPERTIES || QUIET_CATEGORIES.has(category))
}
/** Gradle 组里的分组，按第一次出现的顺序 */
export const categoriesOf = (group: RunTaskGroup): string[] => [...new Set(group.tasks.map(t => t.category || 'other'))]

/** 键盘上下移动用的可见行（组头 + 展开组里的任务；Gradle 组中间多「属性」和分组一层）；筛选时全部展开 */
export type TaskRow =
  | { type: 'group'; group: RunTaskGroup }
  | { type: 'category'; group: RunTaskGroup; category: string; count: number }
  | { type: 'prop'; group: RunTaskGroup; prop: GradleProperty }
  | { type: 'task'; group: RunTaskGroup; task: RunTask }
export function visibleRows(
  groups: readonly RunTaskGroup[],
  overrides: Readonly<Record<string, boolean>>,
  filtering: boolean,
): TaskRow[] {
  const rows: TaskRow[] = []
  for (const group of groups) {
    rows.push({ type: 'group', group })
    if (!filtering && isCollapsed(group, overrides)) continue
    if (group.kind !== 'gradle') {
      for (const task of group.tasks) rows.push({ type: 'task', group, task })
      continue
    }
    const properties = group.gradle?.properties ?? []
    if (properties.length) {
      rows.push({ type: 'category', group, category: PROPERTIES, count: properties.length })
      if (filtering || !isCategoryCollapsed(group, PROPERTIES, overrides))
        for (const prop of properties) rows.push({ type: 'prop', group, prop })
    }
    for (const category of categoriesOf(group)) {
      const tasks = group.tasks.filter(t => (t.category || 'other') === category)
      rows.push({ type: 'category', group, category, count: tasks.length })
      if (filtering || !isCategoryCollapsed(group, category, overrides))
        for (const task of tasks) rows.push({ type: 'task', group, task })
    }
  }
  return rows
}

/** 行的键（键盘焦点、data-task-row） */
export function rowKey(row: TaskRow): string {
  if (row.type === 'group') return `g:${row.group.file}`
  if (row.type === 'category') return `c:${categoryKey(row.group, row.category)}`
  if (row.type === 'prop') return `p:${row.group.file}\u0000${row.prop.key}`
  return `t:${taskKey(row.group, row.task)}`
}

// ---- Gradle 完整任务列表（§9.2）----
/** 一个构建的完整列表记录 */
export interface GradleFull {
  at: number
  /** 加载时构建文件的指纹 */
  stamp: string
  tasks: GradleListedTask[]
}
/** 构建的键：工作区根 + 构建文件夹 */
export const gradleBuildKey = (root: string, buildDir: string): string =>
  `${root.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()}\u0000${buildDir}`

/** 有完整列表的构建：各组的任务换成列表里的（行号和构建文件里写的说明从推断的同名任务里拿，Gradle 的说明放 description） */
export function mergeGradleFull(state: RunTaskState, fulls: ReadonlyMap<string, GradleFull>): RunTaskState {
  if (!fulls.size) return state
  let changed = false
  const groups = state.groups.map(group => {
    const g = group.gradle
    const full = g && fulls.get(gradleBuildKey(state.root, g.buildDir))
    const listed = full ? full.tasks.filter(t => t.project === g!.project) : []
    if (!listed.length) return group
    changed = true
    const known = new Map(group.tasks.map(t => [t.name, t]))
    const tasks = listed.map(t => {
      const mine = known.get(t.name)
      return {
        name: t.name,
        detail: mine?.detail ?? '',
        line: mine?.line ?? null,
        category: t.category,
        description: t.description,
      }
    })
    return { ...group, tasks }
  })
  return changed ? { ...state, groups } : state
}

/** 组头显示的名字：子文件夹写文件夹，根目录写文件名 */
export const groupTitle = (group: RunTaskGroup): string => (group.dir ? group.dir : group.file)

/** 文件名是不是会产生任务（编辑器保存后要重新读） */
export function isTaskFile(path: string): boolean {
  const name = path.replaceAll('\\', '/').split('/').pop() ?? ''
  return (
    name === 'package.json' ||
    name === 'Cargo.toml' ||
    /^(gnu)?makefile$/i.test(name) ||
    /^(build|settings)\.gradle(\.kts)?$/.test(name) ||
    name === 'gradle.properties' ||
    name === 'gradle-wrapper.properties'
  )
}

/** 编辑器里打开的文件是任务列表里的哪个组（package.json、build.gradle(.kts) 加 ▶）；root 是文件所在工作区根目录 */
export function gutterGroupForFile(state: RunTaskState | null, root: string, path: string): RunTaskGroup | null {
  if (!state) return null
  const norm = (v: string): string => v.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  if (norm(state.root) !== norm(root)) return null
  const file = norm(path).replace(/^\.\//, '')
  return state.groups.find(g => (g.kind === 'npm' || g.kind === 'gradle') && norm(g.file) === file) ?? null
}
