// 任务模板的校验（authoring-spec §8）：只做静态检查，不碰文件系统；图标文件由 validateContributions 查。
import type { ExtPackIssue, ExtTaskTemplate } from './types'
import { EXT_LIMITS, EXT_RESERVED_TASK_FILES, EXT_RESERVED_TASK_IDS } from './types'

export const EXT_TASK_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:@/+=-]{0,79}$/

const LOCAL_ID_RE = /^[a-z0-9][a-z0-9-]*$/
const PLACEHOLDERS = new Set(['name', 'runner', 'dir', 'file'])

/** 任务模板里的告警 / 错误；贡献下标由调用方（validateContributions）补上 */
function err(code: string, zh: string, en: string, path?: string): ExtPackIssue {
  return { severity: 'error', scope: 'contribution', code, message: { zh, en }, path, upload: 'reject' }
}
function warn(code: string, zh: string, en: string, path?: string): ExtPackIssue {
  return { severity: 'warning', scope: 'contribution', code, message: { zh, en }, path, upload: 'reject' }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validText(v: unknown): boolean {
  if (typeof v === 'string') return v.length > 0
  if (!isRecord(v)) return false
  return (
    typeof v.zh === 'string' && v.zh.length > 0 && (v.en === undefined || (typeof v.en === 'string' && v.en.length > 0))
  )
}

/** 条件写法：`contains:文字` / `exists:文件名`，可加 `!` 取反；不合法返回 null */
export function parseCondition(cond: string): { negate: boolean; kind: 'contains' | 'exists'; value: string } | null {
  const m = /^(!?)(contains|exists):(.+)$/s.exec(cond)
  if (!m) return null
  return { negate: m[1] === '!', kind: m[2] as 'contains' | 'exists', value: m[3] }
}

/**
 * 静态检查「量词嵌套」：被 * + {n,} 量化的组里面还有被 * + {n,} 量化的部分，如 (a+)+ (a*)* (?:x+y)*。
 * 只是早期报错；(a|aa)*b 这类没有嵌套的写法由运行时的 vm 超时兜底。
 */
export function hasNestedQuantifier(pattern: string): boolean {
  const stack: Array<{ inner: boolean }> = [{ inner: false }]
  /** 读 i 处的量词；返回是否「无上限」以及量词结束位置 */
  const quant = (i: number): { unbounded: boolean; end: number } => {
    const c = pattern[i]
    let unbounded = false
    let end = i
    if (c === '*' || c === '+') {
      unbounded = true
      end = i + 1
    } else if (c === '?') {
      end = i + 1
    } else if (c === '{') {
      const m = /^\{\d+(,\d*)?\}/.exec(pattern.slice(i))
      if (m) {
        unbounded = m[1] === ','
        end = i + m[0].length
      }
    }
    if (end > i && pattern[end] === '?') end++ // 懒惰后缀
    return { unbounded, end }
  }
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === '\\') {
      i += 2
      const q = quant(i)
      if (q.unbounded) stack[stack.length - 1].inner = true
      i = q.end
    } else if (c === '[') {
      let j = i + 1
      if (pattern[j] === '^') j++
      if (pattern[j] === ']') j++
      while (j < pattern.length && pattern[j] !== ']') j += pattern[j] === '\\' ? 2 : 1
      i = j + 1
      const q = quant(i)
      if (q.unbounded) stack[stack.length - 1].inner = true
      i = q.end
    } else if (c === '(') {
      stack.push({ inner: false })
      i++
      if (pattern[i] === '?') {
        const rest = pattern.slice(i)
        if (/^\?<[=!]/.test(rest)) i += 3
        else if (rest[1] === '<') i = pattern.indexOf('>', i) + 1 || pattern.length
        else i += 2
      }
    } else if (c === ')') {
      i++
      const g = stack.length > 1 ? stack.pop()! : { inner: false }
      const q = quant(i)
      if (g.inner && q.unbounded) return true
      const parent = stack[stack.length - 1]
      if (g.inner || q.unbounded) parent.inner = true
      i = q.end
    } else if (c === '|') {
      i++
    } else {
      i++
      const q = quant(i)
      if (q.unbounded) stack[stack.length - 1].inner = true
      i = q.end
    }
  }
  return false
}

/** 命令 / 目录里的 {占位符}：返回不认识的占位符；有落单的花括号也算 */
function badPlaceholders(text: string, allowed: ReadonlySet<string>): string[] {
  const bad: string[] = []
  const rest = text.replace(/\{([^{}]*)\}/g, (_m, name: string) => {
    if (!allowed.has(name)) bad.push(`{${name}}`)
    return ''
  })
  if (/[{}]/.test(rest)) bad.push('{ }')
  return bad
}

function checkWhen(value: unknown, path: string, out: ExtPackIssue[]): void {
  if (typeof value !== 'string') {
    out.push(err('task.when', 'when 必须是字符串', 'when must be a string', path))
    return
  }
  const c = parseCondition(value)
  if (!c) {
    out.push(
      err(
        'task.when',
        `条件写法不对：${value}（应为 contains:文字 或 exists:文件名，可加 ! 取反）`,
        `Invalid condition: ${value} (use contains:text or exists:file, optionally prefixed with !)`,
        path,
      ),
    )
  } else if (c.kind === 'exists' && (/[/\\]/.test(c.value) || c.value.includes('..'))) {
    out.push(
      err(
        'task.when',
        `exists: 后面只能写同目录下的文件名：${value}`,
        `exists: takes a file name in the same directory: ${value}`,
        path,
      ),
    )
  }
}

/** 一个 runner 的值：不能带空格（不能夹参数），除非整个就是一条路径；不能含 shell 特殊字符 */
function runnerValueOk(v: unknown): boolean {
  if (typeof v !== 'string' || v.length === 0) return false
  if (/[;&|<>`$"'()\r\n]/.test(v)) return false
  if (/\s/.test(v)) {
    // 空白只能出现在目录里（C:\Program Files\x\tool.cmd），最后一段不能有，否则就是带参数
    const base = v.split(/[/\\]/).pop() ?? ''
    return /[/\\]/.test(v) && !/\s/.test(base)
  }
  return true
}

function groupCount(pattern: string, flags: string): number | null {
  try {
    const m = new RegExp(`${pattern}|`, flags.replace(/[gy]/g, '')).exec('')
    return m ? m.length - 1 : 0
  } catch {
    return null
  }
}

export function validateTaskTemplate(raw: unknown): { template: ExtTaskTemplate | null; issues: ExtPackIssue[] } {
  const issues: ExtPackIssue[] = []
  if (!isRecord(raw)) {
    return { template: null, issues: [err('task.fields', '任务模板必须是对象', 'A task template must be an object')] }
  }
  // T1
  if (typeof raw.id !== 'string' || raw.id.length > 48 || !LOCAL_ID_RE.test(raw.id)) {
    issues.push(
      err(
        'task.id',
        'id 只能用小写字母、数字和 -，不超过 48 个字符',
        'id may only use lowercase letters, digits and -, up to 48 characters',
        'id',
      ),
    )
  } else if (EXT_RESERVED_TASK_IDS.includes(raw.id)) {
    issues.push(
      err(
        'task.idReserved',
        `id「${raw.id}」是内置任务的保留名`,
        `id "${raw.id}" is reserved for built-in tasks`,
        'id',
      ),
    )
  }
  // T2
  if (!validText(raw.label))
    issues.push(
      err('task.label', 'label 必须是非空文字，或 { zh, en }', 'label must be non-empty text or { zh, en }', 'label'),
    )
  // T3 / T4
  if (!Array.isArray(raw.files) || raw.files.length === 0) {
    issues.push(err('task.files', 'files 至少写一个文件名', 'files needs at least one file name', 'files'))
  } else {
    for (const f of raw.files) {
      if (typeof f !== 'string' || !/^[^/\\*?]+$/.test(f)) {
        issues.push(
          err(
            'task.files',
            `files 里的文件名不能含 / \\ * ?：${String(f)}`,
            `File names in files must not contain / \\ * ?: ${String(f)}`,
            'files',
          ),
        )
      } else if (EXT_RESERVED_TASK_FILES.some(r => r.toLowerCase() === f.toLowerCase())) {
        issues.push(
          err(
            'task.fileReserved',
            `${f} 已由内置任务支持，扩展不能覆盖`,
            `${f} is handled by built-in tasks and cannot be overridden`,
            'files',
          ),
        )
      }
    }
  }
  // T5：固定任务
  let tasks: ExtTaskTemplate['tasks']
  if (raw.tasks !== undefined) {
    if (!Array.isArray(raw.tasks)) {
      issues.push(err('task.fields', 'tasks 必须是数组', 'tasks must be an array', 'tasks'))
    } else {
      const list = raw.tasks.length > EXT_LIMITS.tasksPerFile ? raw.tasks.slice(0, EXT_LIMITS.tasksPerFile) : raw.tasks
      if (raw.tasks.length > EXT_LIMITS.tasksPerFile) {
        issues.push(
          warn(
            'task.tooMany',
            `tasks 超过 ${EXT_LIMITS.tasksPerFile} 个，多出的被忽略`,
            `tasks has more than ${EXT_LIMITS.tasksPerFile} entries; the rest are ignored`,
            'tasks',
          ),
        )
      }
      tasks = []
      list.forEach((t, i) => {
        const p = `tasks[${i}]`
        if (!isRecord(t) || typeof t.name !== 'string') {
          issues.push(err('task.fields', `${p} 必须有 name`, `${p} needs a name`, p))
          return
        }
        if (!EXT_TASK_NAME_RE.test(t.name)) {
          issues.push(
            warn(
              'task.nameDropped',
              `任务名「${t.name}」含不允许的字符或太长，这个任务被忽略`,
              `Task name "${t.name}" has disallowed characters or is too long; the task is ignored`,
              p,
            ),
          )
          return
        }
        if (t.description !== undefined && !validText(t.description)) {
          issues.push(
            err(
              'task.fields',
              `${p}.description 必须是非空文字或 { zh, en }`,
              `${p}.description must be non-empty text or { zh, en }`,
              p,
            ),
          )
        }
        if (t.when !== undefined) checkWhen(t.when, `${p}.when`, issues)
        tasks!.push(t as unknown as { name: string })
      })
    }
  }
  // T6 / T7 / T8：从文件里提取
  if (raw.tasks === undefined && raw.extract === undefined) {
    issues.push(err('task.noTasks', 'tasks 和 extract 至少写一个', 'Provide at least one of tasks and extract'))
  }
  if (raw.extract !== undefined) {
    if (!Array.isArray(raw.extract)) {
      issues.push(err('task.fields', 'extract 必须是数组', 'extract must be an array', 'extract'))
    } else {
      raw.extract.forEach((e, i) => {
        const p = `extract[${i}]`
        if (!isRecord(e) || typeof e.pattern !== 'string' || e.pattern === '') {
          issues.push(
            err('task.extract', `${p}.pattern 必须是非空字符串`, `${p}.pattern must be a non-empty string`, p),
          )
          return
        }
        const flags = e.flags === undefined ? '' : e.flags
        if (typeof flags !== 'string' || !/^(?!.*(.).*\1)[gmiu]*$/.test(flags)) {
          issues.push(
            err(
              'task.extract',
              `${p}.flags 只能是不重复的 g m i u`,
              `${p}.flags may only contain g m i u, each once`,
              p,
            ),
          )
          return
        }
        const groups = groupCount(e.pattern, flags)
        if (groups === null) {
          issues.push(
            err(
              'task.extract',
              `${p}.pattern 不是合法的 JavaScript 正则`,
              `${p}.pattern is not a valid JavaScript regular expression`,
              p,
            ),
          )
          return
        }
        if (hasNestedQuantifier(e.pattern)) {
          issues.push(
            err(
              'task.regexNested',
              `${p}.pattern 有嵌套量词，可能卡死，请改写`,
              `${p}.pattern has nested quantifiers and may hang; rewrite it`,
              p,
            ),
          )
        }
        if (typeof e.name !== 'number' || !Number.isInteger(e.name) || e.name < 1 || e.name > groups) {
          issues.push(
            err(
              'task.extract',
              `${p}.name 必须是 1 到 ${groups} 的分组编号`,
              `${p}.name must be a capture group number from 1 to ${groups}`,
              p,
            ),
          )
        }
        const d = e.description
        if (d !== undefined) {
          const ok =
            (typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= groups) ||
            (isRecord(d) && typeof d.commentBefore === 'string' && d.commentBefore.length > 0)
          if (!ok) {
            issues.push(
              err(
                'task.extract',
                `${p}.description 必须是分组编号或 { commentBefore }`,
                `${p}.description must be a group number or { commentBefore }`,
                p,
              ),
            )
          }
        }
      })
    }
  }
  // T9
  if (typeof raw.command !== 'string' || !/^(?:\{runner\}|[^\s{}]+)(?:\s.*)?$/s.test(raw.command)) {
    issues.push(
      err(
        'task.command',
        'command 的第一个词必须是固定文字或 {runner}',
        'The first word of command must be fixed text or {runner}',
        'command',
      ),
    )
  } else {
    const bad = badPlaceholders(raw.command, PLACEHOLDERS)
    if (bad.length) {
      issues.push(
        err(
          'task.command',
          `command 里只能用 {name} {runner} {dir} {file}，不认识：${bad.join(' ')}`,
          `command may only use {name} {runner} {dir} {file}; unknown: ${bad.join(' ')}`,
          'command',
        ),
      )
    }
    if (raw.command.includes('{runner}') && raw.runner === undefined) {
      issues.push(
        err(
          'task.command',
          'command 用了 {runner}，但没有写 runner',
          'command uses {runner} but runner is missing',
          'command',
        ),
      )
    }
  }
  // T10
  if (raw.runner !== undefined) {
    const r = raw.runner
    if (!isRecord(r) || typeof r.default !== 'string') {
      issues.push(err('task.runner', 'runner 必须有 default', 'runner needs a default', 'runner'))
    } else {
      for (const k of ['windows', 'default', 'fallback'] as const) {
        if (r[k] !== undefined && !runnerValueOk(r[k])) {
          issues.push(
            err(
              'task.runner',
              `runner.${k} 必须是程序名或一条路径，不能带参数或特殊字符`,
              `runner.${k} must be a program name or a single path, without arguments or special characters`,
              `runner.${k}`,
            ),
          )
        }
      }
      if (r.when !== undefined) checkWhen(r.when, 'runner.when', issues)
    }
  }
  // T12
  if (raw.cwd !== undefined) {
    if (typeof raw.cwd !== 'string' || raw.cwd === '') {
      issues.push(err('task.cwd', 'cwd 必须是非空字符串', 'cwd must be a non-empty string', 'cwd'))
    } else {
      const bad = badPlaceholders(raw.cwd, new Set(['dir', 'file']))
      if (bad.length || raw.cwd.includes('..')) {
        issues.push(
          err(
            'task.cwd',
            'cwd 只能用 {dir} {file} 和固定文字，且不能含 ..',
            'cwd may only use {dir}, {file} and fixed text, without ..',
            'cwd',
          ),
        )
      }
    }
  }
  if (raw.icon !== undefined && (typeof raw.icon !== 'string' || !/\.(png|svg)$/.test(raw.icon))) {
    issues.push(
      warn(
        'task.icon',
        'icon 必须是 .png 或 .svg 的包内路径',
        'icon must be a .png or .svg path inside the pack',
        'icon',
      ),
    )
  }
  if (issues.some(i => i.severity === 'error')) return { template: null, issues }
  const template = { ...raw, ...(tasks ? { tasks } : {}) } as unknown as ExtTaskTemplate
  return { template, issues }
}
