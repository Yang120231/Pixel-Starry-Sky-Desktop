// 扩展的任务模板（docs/extensions/authoring-spec.md §8）：按模板里的文件名在项目里找文件，读出任务；只读文件，不执行命令。
// 远程运行时也会跑这份代码：只用 node 内置模块，不碰 electron
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import {
  EXT_LIMITS,
  EXT_TASK_NAME_RE,
  validateTaskTemplate,
  type ExtTaskExtract,
  type ExtTaskTemplate,
  type ExtTaskTemplateWire,
} from '@pixelsky/protocol'
import type { RunTask, RunTaskGroup } from '../../../shared/types/project-tools'

const MAX_DEPTH = 3
const MAX_EXT_FILES = 30
const MAX_TEMPLATES = 100
const MAX_MATCHES = 200
const EXTRACT_TIMEOUT_MS = 200
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor'])
/** 路径里有这些字符的文件夹不读：它们进不了命令行的引号 */
const UNSAFE_PATH = /["%`$\n\r'\u2018-\u201B]/ // 含 PowerShell 也当单引号的弯引号 U+2018–U+201B

export interface ExtTasksIo {
  /** 最多读 maxBytes 字节；读不了返回 null */
  read(path: string, maxBytes: number): Promise<string | null>
  exists(path: string): Promise<boolean>
  platform?: NodeJS.Platform
}

const defaultIo: ExtTasksIo = {
  async read(path, maxBytes) {
    let handle
    try {
      handle = await open(path, 'r')
      const buffer = Buffer.alloc(maxBytes)
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
      return buffer.subarray(0, bytesRead).toString('utf8')
    } catch {
      return null
    } finally {
      await handle?.close().catch(() => undefined)
    }
  },
  async exists(path) {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  },
}

/** 渲染进程传来的模板：最多 100 条，每条再过一遍校验，不合格的丢掉并计数 */
export function sanitizeTemplates(raw: unknown): { templates: ExtTaskTemplateWire[]; dropped: number } {
  if (!Array.isArray(raw)) return { templates: [], dropped: 0 }
  const templates: ExtTaskTemplateWire[] = []
  let dropped = Math.max(0, raw.length - MAX_TEMPLATES)
  for (const entry of raw.slice(0, MAX_TEMPLATES)) {
    const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null
    if (
      !e ||
      typeof e.packKey !== 'string' ||
      typeof e.packId !== 'string' ||
      typeof e.index !== 'number' ||
      !Number.isInteger(e.index) ||
      e.index < 0
    ) {
      dropped++
      continue
    }
    const template = validateTaskTemplate(e.template).template
    if (!template) {
      dropped++
      continue
    }
    templates.push({ packKey: e.packKey, packId: e.packId, index: e.index, template })
  }
  return { templates, dropped }
}

// pattern / flags / text 从外面传进沙箱，正则在沙箱里才构造和执行，超时会被 vm 打断
const EXTRACT_SCRIPT = `
(() => {
  const flags = flags0.includes('g') ? flags0 : flags0 + 'g'
  let re
  try { re = new RegExp(pattern, flags) } catch { return [] }
  const out = []
  let m
  while (out.length < ${MAX_MATCHES} && (m = re.exec(text)) !== null) {
    out.push([m.index, ...Array.from(m, g => (g === undefined ? '' : String(g)))])
    if (m[0] === '') re.lastIndex++
  }
  return out
})()`

/** 在 200 毫秒的超时里跑提取的正则；groups[0] 是整段匹配，groups[n] 是第 n 组。超时返回 'timeout' */
export function runExtract(
  text: string,
  extract: ExtTaskExtract,
  timeoutMs = EXTRACT_TIMEOUT_MS,
): Array<{ index: number; groups: string[] }> | 'timeout' {
  try {
    const raw = runInNewContext(
      EXTRACT_SCRIPT,
      { text, pattern: extract.pattern, flags0: extract.flags ?? '' },
      { timeout: timeoutMs },
    ) as unknown[][]
    return Array.from(raw, row => ({ index: Number(row[0]), groups: Array.from(row.slice(1), String) }))
  } catch (cause) {
    if ((cause as { code?: string })?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return 'timeout'
    return []
  }
}

interface Found {
  /** 相对工作区根（posix），根是 '' */
  dir: string
  name: string
}

/** 广度优先往下最多 3 层，按文件名精确匹配；不跟随符号链接，不进隐藏文件夹 */
async function findFiles(root: string, names: ReadonlySet<string>): Promise<{ files: Found[]; truncated: boolean }> {
  const files: Found[] = []
  let level = ['']
  for (let depth = 0; depth <= MAX_DEPTH && level.length; depth++) {
    const next: string[] = []
    for (const dir of level) {
      let entries
      try {
        entries = await readdir(join(root, ...(dir ? dir.split('/') : [])), { withFileTypes: true })
      } catch {
        continue
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          const child = dir ? `${dir}/${entry.name}` : entry.name
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.') && !UNSAFE_PATH.test(child)) next.push(child)
        } else if (entry.isFile() && names.has(entry.name) && !UNSAFE_PATH.test(dir))
          files.push({ dir, name: entry.name })
      }
    }
    level = next
  }
  return { files: files.slice(0, MAX_EXT_FILES), truncated: files.length > MAX_EXT_FILES }
}

/** `[!]contains:文字` / `[!]exists:文件名`；不认识的写法当作不成立 */
async function evalWhen(cond: string | undefined, text: string, absDir: string, io: ExtTasksIo): Promise<boolean> {
  if (cond === undefined) return true
  const negate = cond.startsWith('!')
  const m = /^(contains|exists):([\s\S]*)$/.exec(negate ? cond.slice(1) : cond)
  if (!m) return false
  let hit: boolean
  if (m[1] === 'contains') hit = text.includes(m[2])
  else hit = safeRel(m[2]) !== null && (await io.exists(join(absDir, safeRel(m[2])!)))
  return negate ? !hit : hit
}

/** 相对路径：不能是绝对路径，也不能往上跳 */
function safeRel(path: string): string | null {
  if (!path || /^([/\\]|[A-Za-z]:)/.test(path) || path.split(/[/\\]/).includes('..')) return null
  return path
}

/** 文本里 index 位置所在行的前一行（去掉首尾空白）；没有前一行返回 '' */
function previousLine(text: string, index: number): string {
  const lineStart = index === 0 ? 0 : text.lastIndexOf('\n', index - 1) + 1
  if (lineStart === 0) return ''
  const prevStart = text.lastIndexOf('\n', lineStart - 2) + 1
  return text.slice(prevStart, lineStart - 1).trim()
}

const lineOf = (text: string, index: number): number => {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

async function templateTasks(
  template: ExtTaskTemplate,
  text: string,
  absDir: string,
  io: ExtTasksIo,
): Promise<{ tasks: RunTask[]; truncated: boolean }> {
  const tasks: RunTask[] = []
  const seen = new Set<string>()
  let truncated = false
  const add = (task: RunTask): void => {
    if (tasks.length >= EXT_LIMITS.tasksPerFile || seen.has(task.name) || !EXT_TASK_NAME_RE.test(task.name)) return
    seen.add(task.name)
    tasks.push(task)
  }
  for (const def of template.tasks ?? []) {
    if (!(await evalWhen(def.when, text, absDir, io))) continue
    add({
      name: def.name,
      detail: '',
      line: null,
      ...(def.description !== undefined ? { extDetail: def.description } : {}),
    })
  }
  for (const extract of template.extract ?? []) {
    const found = runExtract(text, extract)
    if (found === 'timeout') {
      truncated = true
      continue
    }
    for (const hit of found) {
      const name = hit.groups[extract.name]
      if (!name) continue
      const spec = extract.description
      let description = ''
      if (typeof spec === 'number') description = hit.groups[spec] ?? ''
      else if (spec) {
        const prev = previousLine(text, hit.index)
        if (prev.startsWith(spec.commentBefore)) description = prev.slice(spec.commentBefore.length).trim()
      }
      add({ name, detail: '', line: lineOf(text, hit.index), ...(description ? { extDetail: description } : {}) })
    }
  }
  return { tasks, truncated }
}

/** 选运行器：windows 优先，when 不成立用 fallback；runnerLocal = 选中的是项目里的文件 */
async function pickRunner(
  template: ExtTaskTemplate,
  text: string,
  absDir: string,
  io: ExtTasksIo,
): Promise<{ runner: string | null; runnerLocal: boolean }> {
  const spec = template.runner
  if (!spec) return { runner: null, runnerLocal: false }
  const platform = io.platform ?? process.platform
  const chosen = platform === 'win32' ? (spec.windows ?? spec.default) : spec.default
  const fallen = !(await evalWhen(spec.when, text, absDir, io)) && spec.fallback !== undefined
  const runner = fallen ? spec.fallback! : chosen
  if (fallen || /\s/.test(runner)) return { runner, runnerLocal: false }
  const rel = safeRel(runner.replace(/^\.[/\\]/, ''))
  return { runner, runnerLocal: rel !== null && (await io.exists(join(absDir, rel))) }
}

export async function readExtTaskGroups(
  root: string,
  templates: unknown,
  io: ExtTasksIo = defaultIo,
): Promise<{ groups: RunTaskGroup[]; truncated: boolean }> {
  const clean = sanitizeTemplates(templates)
  let truncated = clean.dropped > 0
  if (!clean.templates.length) return { groups: [], truncated }
  const names = new Set(clean.templates.flatMap(t => t.template.files))
  const found = await findFiles(root, names)
  truncated ||= found.truncated
  const groups: RunTaskGroup[] = []
  for (const file of found.files) {
    const absDir = file.dir ? join(root, ...file.dir.split('/')) : root
    const text = await io.read(join(absDir, file.name), EXT_LIMITS.extractBytes)
    if (text === null) continue
    for (const wire of clean.templates) {
      const { template } = wire
      if (!template.files.includes(file.name)) continue
      const result = await templateTasks(template, text, absDir, io)
      truncated ||= result.truncated
      if (!result.tasks.length) continue
      const { runner, runnerLocal } = await pickRunner(template, text, absDir, io)
      groups.push({
        kind: 'ext',
        file: file.dir ? `${file.dir}/${file.name}` : file.name,
        dir: file.dir,
        tasks: result.tasks,
        ext: {
          packKey: wire.packKey,
          packId: wire.packId,
          templateId: template.id,
          label: template.label,
          ...(template.icon ? { icon: template.icon } : {}),
          command: template.command,
          cwd: template.cwd ?? '{dir}',
          runner,
          runnerLocal,
        },
      })
    }
  }
  return { groups, truncated }
}
