// 代码模式左栏「任务」（docs/ui/coding-tasks.md §2）：只读文件找出项目里能跑的命令，不执行任何东西
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { LOCKFILE_NAMES, detectPackageManager, type PackageManager } from '@pixelsky/protocol'
import type { RunTask, RunTaskGroup, RunTaskKind, RunTaskState } from '../../../shared/types/project-tools'

const MAX_DEPTH = 3
const MAX_FILES = 30
const MAX_BYTES = 512 * 1024
const MAX_MAKE_TARGETS = 50
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor'])
const MAKEFILES = new Set(['Makefile', 'makefile', 'GNUmakefile'])
/** 根目录组的顺序 */
const KIND_ORDER: Record<RunTaskKind, number> = { npm: 0, make: 1, cargo: 2 }

interface Manifest {
  kind: RunTaskKind
  /** 相对工作区根目录的文件夹（posix），根是 '' */
  dir: string
  name: string
}

function manifestKind(name: string): RunTaskKind | null {
  if (name === 'package.json') return 'npm'
  if (MAKEFILES.has(name)) return 'make'
  if (name === 'Cargo.toml') return 'cargo'
  return null
}

/** 广度优先往下最多 3 层找清单文件；不跟随符号链接 */
async function findManifests(root: string): Promise<{ files: Manifest[]; truncated: boolean }> {
  const files: Manifest[] = []
  let level = ['']
  for (let depth = 0; depth <= MAX_DEPTH && level.length; depth++) {
    const next: string[] = []
    for (const dir of level) {
      let entries
      try {
        entries = await readdir(join(root, dir), { withFileTypes: true })
      } catch {
        continue
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.'))
            next.push(dir ? `${dir}/${entry.name}` : entry.name)
        } else if (entry.isFile()) {
          const kind = manifestKind(entry.name)
          if (kind) files.push({ kind, dir, name: entry.name })
        }
      }
    }
    level = next
  }
  return { files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES }
}

async function readSmall(path: string): Promise<string | null> {
  try {
    if ((await stat(path)).size > MAX_BYTES) return null
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

function parseObject(text: string | null): Record<string, unknown> | null {
  if (text === null) return null
  try {
    const data: unknown = JSON.parse(text)
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 键在文件里的行号（1 起）：先定位 "scripts"，再从那里往后找 "键":；找不到 null */
function keyLine(text: string, key: string): number | null {
  const scripts = /"scripts"\s*:/.exec(text)
  const from = scripts ? scripts.index + scripts[0].length : 0
  const hit = new RegExp(`"${escapeRegExp(key)}"\\s*:`).exec(text.slice(from))
  if (!hit) return null
  let line = 1
  const end = from + hit.index
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

function npmTasks(text: string, pkg: Record<string, unknown>): RunTask[] {
  const scripts = pkg.scripts
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return []
  const tasks: RunTask[] = []
  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body !== 'string' || !/^[\w:.-]+$/.test(name)) continue
    tasks.push({ name, detail: body, line: keyLine(text, name) })
  }
  return tasks
}

function makeTasks(text: string): RunTask[] {
  const tasks: RunTask[] = []
  const seen = new Set<string>()
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length && tasks.length < MAX_MAKE_TARGETS; i++) {
    // 行首 `目标:`，`:=`、`::=` 是变量赋值
    const match = /^([^\s:#=][^:#=]*?)\s*:(?![:=])/.exec(lines[i])
    if (!match) continue
    // 一行可以写多个目标，空格分开
    for (const name of match[1].split(/\s+/)) {
      if (tasks.length >= MAX_MAKE_TARGETS) break
      if (!/^[A-Za-z0-9][\w.-]*$/.test(name) || /[%$]/.test(name) || seen.has(name)) continue
      seen.add(name)
      tasks.push({ name, detail: '', line: i + 1 })
    }
  }
  return tasks
}

function cargoTasks(text: string, dir: string): RunTask[] {
  const hasPackage = /^\s*\[package\]/m.test(text)
  if (!hasPackage && !/^\s*\[workspace\]/m.test(text)) return []
  const names = hasPackage ? ['build', 'check', 'test', 'run'] : ['build', 'check', 'test']
  const manifest = dir ? `${dir}/Cargo.toml` : ''
  const path = /\s/.test(manifest) ? `"${manifest}"` : manifest
  return names.map(name => ({
    name,
    detail: dir ? `cargo ${name} --manifest-path ${path}` : `cargo ${name}`,
    line: null,
  }))
}

export async function readRunTasks(root: string): Promise<RunTaskState> {
  const { files, truncated } = await findManifests(root)
  const absolute = (dir: string) => (dir ? join(root, ...dir.split('/')) : root)

  // 包管理器：从文件夹往上到根，第一个有锁文件或 packageManager 字段的地方决定
  const managers = new Map<string, PackageManager | null>()
  const managerAt = async (dir: string): Promise<PackageManager | null> => {
    if (managers.has(dir)) return managers.get(dir)!
    const field = parseObject(await readSmall(join(absolute(dir), 'package.json')))?.packageManager
    const present = new Set<string>()
    await Promise.all(
      LOCKFILE_NAMES.map(name =>
        stat(join(absolute(dir), name)).then(
          () => present.add(name),
          () => {},
        ),
      ),
    )
    const found =
      typeof field === 'string' || present.size > 0 ? detectPackageManager(field, name => present.has(name)) : null
    managers.set(dir, found)
    return found
  }
  const managerFor = async (dir: string): Promise<PackageManager> => {
    for (let at = dir; ; at = at.slice(0, Math.max(at.lastIndexOf('/'), 0))) {
      const found = await managerAt(at)
      if (found) return found
      if (!at) return 'npm'
    }
  }

  const groups: RunTaskGroup[] = []
  for (const file of files) {
    const text = await readSmall(join(absolute(file.dir), file.name))
    if (text === null) continue
    const path = file.dir ? `${file.dir}/${file.name}` : file.name
    let tasks: RunTask[]
    let manager: PackageManager | undefined
    if (file.kind === 'npm') {
      const pkg = parseObject(text)
      tasks = pkg ? npmTasks(text, pkg) : []
      if (tasks.length) manager = await managerFor(file.dir)
    } else if (file.kind === 'make') tasks = makeTasks(text)
    else tasks = cargoTasks(text, file.dir)
    if (!tasks.length) continue
    groups.push({ kind: file.kind, file: path, dir: file.dir, ...(manager ? { manager } : {}), tasks })
  }
  groups.sort((a, b) => {
    if (!a.dir !== !b.dir) return a.dir ? 1 : -1
    if (!a.dir) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0
  })
  return { root, groups, truncated }
}
