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

/**
 * 静态检查「被量化的分支组」：组里有顶层 `|`，后面又跟着可重复的量词（+ * {n,} {n,m}（m>1） {n}（n>1），含懒惰后缀），
 * 如 (a|aa)+ (a|b)* (?:x|xy){2,}。分支有重叠时同样指数级回溯，hasNestedQuantifier 抓不到。
 * `?`、{0,1}、{1} 最多一次，放行；转义、字符类里的 | ( ) 不算。
 */
export function hasQuantifiedAlternation(pattern: string): boolean {
  const stack: Array<{ alt: boolean }> = [{ alt: false }]
  /** 读 i 处的量词；返回是否「可重复多次」 */
  const repeats = (i: number): boolean => {
    const c = pattern[i]
    if (c === '*' || c === '+') return true
    if (c === '{') {
      // {n}（n>1）也会重复：(a|aa){40} 一样指数级回溯
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(pattern.slice(i))
      if (m) return m[2] ? m[3] === '' || Number(m[3]) > 1 : Number(m[1]) > 1
    }
    return false
  }
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === '\\') {
      i += 2
    } else if (c === '[') {
      let j = i + 1
      if (pattern[j] === '^') j++
      if (pattern[j] === ']') j++
      while (j < pattern.length && pattern[j] !== ']') j += pattern[j] === '\\' ? 2 : 1
      i = j + 1
    } else if (c === '(') {
      stack.push({ alt: false })
      i++
      if (pattern[i] === '?') {
        const rest = pattern.slice(i)
        if (/^\?<[=!]/.test(rest)) i += 3
        else if (rest[1] === '<') i = pattern.indexOf('>', i) + 1 || pattern.length
        else i += 2
      }
    } else if (c === ')') {
      i++
      const g = stack.length > 1 ? stack.pop()! : { alt: false }
      if (g.alt && repeats(i)) return true
      // 内层组的分支也算外层的：((a|aa))+ 、(x(a|aa))+ 同样指数级回溯
      if (g.alt) stack[stack.length - 1].alt = true
    } else if (c === '|') {
      stack[stack.length - 1].alt = true
      i++
    } else {
      i++
    }
  }
  return false
}

/** 128 位 ASCII 位图 + 「可能含非 ASCII 字符」标记；hasAmbiguousQuantifiers 用它判断两个字符集是否重叠 */
interface CharSet {
  bits: Uint32Array
  other: boolean
}
const csNew = (other = false): CharSet => ({ bits: new Uint32Array(4), other })
const csAdd = (s: CharSet, c: number): void => {
  if (c < 128) s.bits[c >> 5] |= 1 << (c & 31)
  else s.other = true
}
const csAddRange = (s: CharSet, lo: number, hi: number): void => {
  for (let c = lo; c <= Math.min(hi, 127); c++) csAdd(s, c)
  if (hi > 127) s.other = true
}
const csUnion = (a: CharSet, b: CharSet): CharSet => {
  const r = csNew(a.other || b.other)
  for (let k = 0; k < 4; k++) r.bits[k] = a.bits[k] | b.bits[k]
  return r
}
/** 把 b 并进 a（原地） */
const csMerge = (a: CharSet, b: CharSet): void => {
  for (let k = 0; k < 4; k++) a.bits[k] |= b.bits[k]
  a.other ||= b.other
}
/** 取反：非 ASCII 一律算「可能含」 */
const csNot = (s: CharSet): CharSet => {
  const r = csNew(true)
  for (let k = 0; k < 4; k++) r.bits[k] = ~s.bits[k]
  return r
}
const csFull = (): CharSet => csNot(csNew())
const csOverlap = (a: CharSet, b: CharSet): boolean => {
  if (a.other && b.other) return true
  for (let k = 0; k < 4; k++) if ((a.bits[k] & b.bits[k]) !== 0) return true
  return false
}
/** \d \w \s 及其取反 \D \W \S；不是这六个返回 null */
const classSet = (kind: string): CharSet | null => {
  const s = csNew()
  const lower = kind.toLowerCase()
  if (lower === 'd') csAddRange(s, 48, 57)
  else if (lower === 'w') {
    csAddRange(s, 48, 57)
    csAddRange(s, 65, 90)
    csAddRange(s, 97, 122)
    csAdd(s, 95)
  } else if (lower === 's') {
    for (const c of [9, 10, 11, 12, 13, 32]) csAdd(s, c)
    s.other = true // 还有 U+00A0、U+2028 等非 ASCII 空白
  } else return null
  return kind === lower ? s : csNot(s)
}

/** hasAmbiguousQuantifiers 的小 AST：item = 带量词的单个字符集或组（组有 alts）；look = 环视（零宽） */
interface QItem {
  t: 'item'
  min: number
  max: number
  /** 自身能匹配的所有字符（组 = 内部所有字符的并集） */
  cs: CharSet
  /** 能出现在这个元素开头的字符 */
  first: CharSet
  nullable: boolean
  /** 内部（不含自己的量词）是否还有可变次数的元素 */
  variable: boolean
  alts?: QNode[][]
}
interface QLook {
  t: 'look'
  alts: QNode[][]
}
type QNode = QItem | QLook

/** 一个序列开头能出现的字符，以及整个序列是否可以匹配空串（环视零宽，跳过） */
function seqFirst(seq: QNode[]): { first: CharSet; nullable: boolean } {
  let first = csNew()
  for (const n of seq) {
    if (n.t === 'look') continue
    first = csUnion(first, n.first)
    if (!n.nullable) return { first, nullable: false }
  }
  return { first, nullable: true }
}

/**
 * 静态检查「相邻且可重叠的量词」：hasNestedQuantifier / hasQuantifiedAlternation 拦不住 a*a*a*a*b 这类写法，
 * 它没有嵌套也没有分支，但回溯是 O(n^k)（k = 量词个数），截断到 200 字符也会卡死渲染线程。
 *
 * 做法：把正则（不带 flag，按非 unicode 解释）解析成小 AST，再用 Glushkov 式的 follow 集判断每个可变次数元素是否「歧义」——
 * 它自己能匹配的字符和它后面能接上的首字符有重叠，就说明同一段输入有多种切分方式。
 * 每个歧义元素给代价贡献一个因子（无上限 = maxLength+1，有上限 = max-min+1），有上限的组内部代价取 max 次幂，
 * 无上限的组内部若还有可变元素按无穷大算，分支代价相乘（保守）。总代价超过 (maxLength+1)^2 就拒绝，即最多允许两个无上限的歧义量词。
 *
 * 字符集用 128 位 ASCII 位图 + 「含非 ASCII」标记近似；`.`、反向引用按全集，取反类的非 ASCII 一律算有。
 * 整个模式结尾处的 follow 为空（.test() 找到第一个成功就返回）。耗时线性于模式长度，永不抛错：
 * 解析器对不合法的正则也会给出结果；万一出了意外（如括号嵌套到栈溢出）按「不安全」返回 true，宁可错拒也不放过可能卡死的写法。
 */
export function hasAmbiguousQuantifiers(pattern: string, maxLength = 200): boolean {
  try {
    return ambiguityCost(pattern, maxLength) > (maxLength + 1) ** 2
  } catch {
    return true
  }
}

/** hasAmbiguousQuantifiers 的主体：解析 + 估算最坏回溯代价 */
function ambiguityCost(pattern: string, maxLength: number): number {
  let pos = 0
  const EMPTY = csNew()
  const quantRe = /\{(\d+)(?:(,)(\d*))?\}/y
  /** 读 pos 处的量词（含懒惰后缀）；没有量词就是 {1,1}；`{` 不构成合法量词时留给主循环按字面字符处理 */
  const readQuant = (): { min: number; max: number } => {
    let min = 1
    let max = 1
    const c = pattern[pos]
    if (c === '*') [min, max] = [0, Infinity]
    else if (c === '+') [min, max] = [1, Infinity]
    else if (c === '?') [min, max] = [0, 1]
    else if (c === '{') {
      quantRe.lastIndex = pos
      const m = quantRe.exec(pattern)
      if (!m) return { min, max }
      min = Number(m[1])
      max = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : min
      pos += m[0].length - 1
    } else return { min, max }
    pos++
    if (pattern[pos] === '?') pos++
    return { min, max }
  }
  /** pos 指向反斜杠；返回单个字符码或一个字符集，pos 移到转义之后 */
  const readEscape = (inClass: boolean): number | CharSet => {
    const c = pattern[pos + 1]
    if (c === undefined) {
      pos++
      return 92
    }
    pos += 2
    const set = classSet(c)
    if (set) return set
    const simple: Record<string, number> = { n: 10, r: 13, t: 9, v: 11, f: 12, '0': 0 }
    if (c in simple) return simple[c]
    if (c === 'b' && inClass) return 8
    const hex = c === 'x' ? 2 : c === 'u' ? 4 : 0
    if (hex) {
      const h = pattern.slice(pos, pos + hex)
      if (h.length === hex && /^[0-9a-fA-F]+$/.test(h)) {
        pos += hex
        return parseInt(h, 16)
      }
    } else if (c === 'c') {
      const l = pattern[pos]
      if (l !== undefined && /[A-Za-z]/.test(l)) {
        pos++
        return l.charCodeAt(0) % 32
      }
      pos-- // \c 后面不是字母：反斜杠按字面字符，c 留给后面
      return 92
    }
    return c.charCodeAt(0)
  }
  /** pos 指向 `[`；JS 里 `[]` 是空类、`[^]` 是全集，不像 PCRE 把开头的 `]` 当字面字符 */
  const readClass = (): CharSet => {
    pos++
    const negate = pattern[pos] === '^'
    if (negate) pos++
    const s = csNew()
    const item = (): number | CharSet => (pattern[pos] === '\\' ? readEscape(true) : pattern.charCodeAt(pos++))
    const put = (x: number | CharSet): void => (typeof x === 'number' ? csAdd(s, x) : csMerge(s, x))
    while (pos < pattern.length && pattern[pos] !== ']') {
      const a = item()
      if (pattern[pos] === '-' && pos + 1 < pattern.length && pattern[pos + 1] !== ']') {
        pos++
        const b = item()
        if (typeof a === 'number' && typeof b === 'number') csAddRange(s, a, b)
        else {
          csAdd(s, 45) // 端点是 \d 之类：连字符按字面字符
          put(a)
          put(b)
        }
      } else put(a)
    }
    pos++ // `]`
    return negate ? csNot(s) : s
  }
  const atom = (cs: CharSet, q: { min: number; max: number }): QItem => ({
    t: 'item',
    ...q,
    cs,
    first: cs,
    nullable: q.min === 0,
    variable: false,
  })
  const group = (alts: QNode[][], q: { min: number; max: number }): QItem => {
    const cs = csNew()
    const first = csNew()
    let nullable = false
    let variable = false
    for (const seq of alts) {
      const f = seqFirst(seq)
      csMerge(first, f.first)
      nullable ||= f.nullable
      for (const n of seq) {
        if (n.t === 'look') continue
        csMerge(cs, n.cs)
        variable ||= n.min !== n.max || n.variable
      }
    }
    return { t: 'item', ...q, cs, first, nullable: nullable || q.min === 0, variable, alts }
  }
  /** 解析到 `)` 或结尾为止（`)` 留给调用方） */
  const parseAlts = (): QNode[][] => {
    const alts: QNode[][] = [[]]
    while (pos < pattern.length) {
      const c = pattern[pos]
      const seq = alts[alts.length - 1]
      if (c === ')') break
      if (c === '|') {
        alts.push([])
        pos++
      } else if (c === '^' || c === '$' || c === '*' || c === '+' || c === '?') {
        pos++ // 断言零宽；落单的量词是不合法的写法，跳过
      } else if (c === '(') {
        pos++
        let look = false
        if (pattern[pos] === '?') {
          const rest = pattern.slice(pos, pos + 3)
          if (/^\?<[=!]/.test(rest)) {
            look = true
            pos += 3
          } else if (/^\?[=!]/.test(rest)) {
            look = true
            pos += 2
          } else if (rest[1] === '<') pos = pattern.indexOf('>', pos) + 1 || pattern.length
          else pos += 2
        }
        const body = parseAlts()
        if (pattern[pos] === ')') pos++
        const q = readQuant() // 环视后面的量词没有意义，读掉丢弃
        seq.push(look ? { t: 'look', alts: body } : group(body, q))
      } else if (c === '[') {
        const cs = readClass()
        seq.push(atom(cs, readQuant()))
      } else if (c === '\\') {
        const next = pattern[pos + 1] ?? ''
        if (next === 'b' || next === 'B') {
          pos += 2
        } else if (/[1-9]/.test(next) || (next === 'k' && pattern[pos + 2] === '<')) {
          // 反向引用：不知道引用了什么，按全集
          if (next === 'k') pos = pattern.indexOf('>', pos) + 1 || pattern.length
          else {
            pos++
            while (/[0-9]/.test(pattern[pos] ?? '')) pos++
          }
          seq.push(atom(csFull(), readQuant()))
        } else {
          const e = readEscape(false)
          const cs = typeof e === 'number' ? csNew() : e
          if (typeof e === 'number') csAdd(cs, e)
          seq.push(atom(cs, readQuant()))
        }
      } else if (c === '.') {
        pos++
        seq.push(atom(csFull(), readQuant()))
      } else {
        const cs = csNew()
        csAdd(cs, pattern.charCodeAt(pos++))
        seq.push(atom(cs, readQuant()))
      }
    }
    return alts
  }

  const walkAlts = (alts: QNode[][], follow: CharSet): number => {
    let cost = 1
    for (const seq of alts) cost *= walkSeq(seq, follow)
    return cost
  }
  /** 从后往前走，随时知道「后面能接上的首字符」；follow = 整个序列之后能接上的首字符 */
  const walkSeq = (seq: QNode[], follow: CharSet): number => {
    let cost = 1
    let cur = follow
    for (let i = seq.length - 1; i >= 0; i--) {
      const n = seq[i]
      if (n.t === 'look') {
        cost *= walkAlts(n.alts, EMPTY) // 环视零宽、可空：只贡献自己的代价，不影响 follow
        continue
      }
      let c = 1
      if (n.alts) {
        const inner = walkAlts(n.alts, n.max > 1 ? csUnion(cur, n.first) : cur) // 重复的组：末尾还能接回组开头
        if (n.max === Infinity) c = n.variable ? Infinity : inner
        else c = n.max > 1 ? inner ** n.max : inner
      }
      if (n.min !== n.max && csOverlap(n.cs, cur)) c *= n.max === Infinity ? maxLength + 1 : n.max - n.min + 1
      cost *= c
      cur = n.nullable ? csUnion(cur, n.first) : n.first
    }
    return cost
  }

  const top = parseAlts()
  while (pos < pattern.length) {
    pos++ // 落单的 `)`（不合法的写法）：当作分支分隔继续解析
    top.push(...parseAlts())
  }
  return walkAlts(top, EMPTY)
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
