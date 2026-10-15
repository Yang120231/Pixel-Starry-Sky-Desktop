import { EXT_LIMITS } from '@pixelsky/protocol'

// 片段文件解析和 VS Code 语法 → CodeMirror 模板的转换（纯函数，node 测试直接用）

export interface ParsedSnippet {
  name: string
  prefixes: string[]
  body: string
  description: string
}

export interface SnippetVariables {
  TM_FILENAME: string
  TM_FILENAME_BASE: string
  TM_SELECTED_TEXT: string
  CLIPBOARD: string
  CURRENT_YEAR: string
  CURRENT_MONTH: string
  CURRENT_DATE: string
  CURRENT_HOUR: string
  CURRENT_MINUTE: string
  UUID: string
  LINE_COMMENT: string
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function textOf(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (Array.isArray(v) && v.every(x => typeof x === 'string')) return v.join('\n')
  return null
}

export function parseSnippetFile(json: unknown): { snippets: ParsedSnippet[]; warnings: string[] } {
  const snippets: ParsedSnippet[] = []
  const warnings: string[] = []
  if (!isRecord(json)) return { snippets, warnings: ['snippet file is not an object'] }
  for (const [name, raw] of Object.entries(json)) {
    if (snippets.length >= EXT_LIMITS.snippetsPerFile) {
      warnings.push(`more than ${EXT_LIMITS.snippetsPerFile} snippets, the rest are ignored`)
      break
    }
    if (!isRecord(raw)) {
      warnings.push(`${name}: not an object`)
      continue
    }
    const body = textOf(raw.body)
    if (body === null) {
      warnings.push(`${name}: body must be a string or an array of strings`)
      continue
    }
    const rawPrefix = Array.isArray(raw.prefix) ? raw.prefix : [raw.prefix]
    const prefixes: string[] = []
    for (const p of rawPrefix) {
      if (typeof p !== 'string' || !p) {
        warnings.push(`${name}: prefix must be a non-empty string`)
      } else if ([...p].length > EXT_LIMITS.snippetPrefixChars) {
        warnings.push(`${name}: prefix "${p.slice(0, 12)}…" is longer than ${EXT_LIMITS.snippetPrefixChars} characters`)
      } else if (!prefixes.includes(p)) {
        prefixes.push(p)
      }
    }
    if (prefixes.length === 0) {
      warnings.push(`${name}: no usable prefix`)
      continue
    }
    snippets.push({ name, prefixes, body, description: typeof raw.description === 'string' ? raw.description : '' })
  }
  return { snippets, warnings }
}

type Node =
  | { t: 'text'; s: string }
  | { t: 'tab'; n: number; def: Node[] }
  | { t: 'choice'; n: number; opts: string[] }
  | { t: 'var'; name: string; def: Node[] | null; raw: string }

const DIGIT = /[0-9]/
const NAME_START = /[A-Za-z_]/
const NAME_CHAR = /\w/

/** 从 start 起解析；inside 为 true 时遇到没转义的 } 就停（不吃掉它） */
function parseNodes(src: string, start: number, inside: boolean): { nodes: Node[]; end: number } {
  const nodes: Node[] = []
  let text = ''
  const flush = () => {
    if (text) nodes.push({ t: 'text', s: text })
    text = ''
  }
  let i = start
  while (i < src.length) {
    const c = src[i]
    if (c === '\\' && i + 1 < src.length && '$}\\'.includes(src[i + 1])) {
      text += src[i + 1]
      i += 2
      continue
    }
    if (c === '}' && inside) break
    if (c !== '$') {
      text += c
      i++
      continue
    }
    const next = src[i + 1]
    if (next !== undefined && DIGIT.test(next)) {
      let j = i + 1
      while (j < src.length && DIGIT.test(src[j])) j++
      flush()
      nodes.push({ t: 'tab', n: Number(src.slice(i + 1, j)), def: [] })
      i = j
      continue
    }
    if (next !== undefined && NAME_START.test(next)) {
      let j = i + 1
      while (j < src.length && NAME_CHAR.test(src[j])) j++
      flush()
      nodes.push({ t: 'var', name: src.slice(i + 1, j), def: null, raw: src.slice(i, j) })
      i = j
      continue
    }
    if (next === '{') {
      const parsed = parseBraced(src, i)
      if (parsed) {
        flush()
        nodes.push(parsed.node)
        i = parsed.end
        continue
      }
    }
    text += '$'
    i++
  }
  flush()
  return { nodes, end: i }
}

/** 找 ${ … } 的结尾（跳过转义），用于不支持的变换，找不到返回 -1 */
function findClose(src: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === '\\') i++
    else if (src[i] === '}') return i
  }
  return -1
}

function parseBraced(src: string, at: number): { node: Node; end: number } | null {
  let j = at + 2
  const isTab = j < src.length && DIGIT.test(src[j])
  const isVar = j < src.length && NAME_START.test(src[j])
  if (!isTab && !isVar) return null
  while (j < src.length && (isTab ? DIGIT.test(src[j]) : NAME_CHAR.test(src[j]))) j++
  const head = src.slice(at + 2, j)
  const make = (def: Node[] | null, end: number): Node =>
    isTab ? { t: 'tab', n: Number(head), def: def ?? [] } : { t: 'var', name: head, def, raw: src.slice(at, end + 1) }
  const sep = src[j]
  if (sep === '}') return { node: make(null, j), end: j + 1 }
  if (sep === ':') {
    const inner = parseNodes(src, j + 1, true)
    if (src[inner.end] !== '}') return null
    return { node: make(inner.nodes, inner.end), end: inner.end + 1 }
  }
  if (sep === '|' && isTab) {
    const opts: string[] = []
    let cur = ''
    for (let k = j + 1; k < src.length; k++) {
      const c = src[k]
      if (c === '\\' && k + 1 < src.length && ',|\\'.includes(src[k + 1])) {
        cur += src[++k]
      } else if (c === ',') {
        opts.push(cur)
        cur = ''
      } else if (c === '|' && src[k + 1] === '}') {
        opts.push(cur)
        return { node: { t: 'choice', n: Number(head), opts }, end: k + 2 }
      } else cur += c
    }
    return null
  }
  if (sep === '/') {
    // 变换不支持：整段原样插入
    const close = findClose(src, j + 1)
    if (close < 0) return null
    return { node: { t: 'text', s: src.slice(at, close + 1) }, end: close + 1 }
  }
  return null
}

/** 默认值 / 变量值里不能有 { }（CodeMirror 的限制），整体拍平成纯文本 */
function flatten(nodes: Node[], vars: Partial<SnippetVariables>, defaults: Map<number, string>): string {
  return nodes.map(n => renderNode(n, vars, true, defaults)).join('')
}

/** 每个编号第一处带默认文本的出现（含嵌套、选项取第一个），同编号的其它出现都以它为初始文本（同 VS Code） */
function collectDefaults(nodes: Node[], vars: Partial<SnippetVariables>, out: Map<number, string>): void {
  for (const n of nodes) {
    if (n.t === 'tab') {
      if (!out.has(n.n)) {
        const def = flatten(n.def, vars, out)
        if (def) out.set(n.n, def)
      }
      collectDefaults(n.def, vars, out)
    } else if (n.t === 'choice') {
      const first = (n.opts[0] ?? '').replace(/[{}]/g, '')
      if (first && !out.has(n.n)) out.set(n.n, first)
    } else if (n.t === 'var' && n.def) {
      collectDefaults(n.def, vars, out)
    }
  }
}

function renderNode(n: Node, vars: Partial<SnippetVariables>, flat: boolean, defaults: Map<number, string>): string {
  const esc = (s: string) => (flat ? s.replace(/[{}]/g, '') : s.replace(/[{}]/g, '\\$&'))
  switch (n.t) {
    case 'text':
      return esc(n.s)
    case 'choice': {
      // 展开时用第一个
      const first = (n.opts[0] ?? '').replace(/[{}]/g, '') || (n.n === 0 ? '' : (defaults.get(n.n) ?? ''))
      return flat ? first : `\${${n.n}${first ? `:${first}` : ''}}`
    }
    case 'tab': {
      // $0 是结束位置，不继承默认文本
      const def = flatten(n.def, vars, defaults) || (n.n === 0 ? '' : (defaults.get(n.n) ?? ''))
      return flat ? def : `\${${n.n}${def ? `:${def}` : ''}}`
    }
    case 'var': {
      const value = (vars as Record<string, string | undefined>)[n.name]
      if (value) return esc(value)
      if (n.def) return esc(flatten(n.def, vars, defaults))
      // 提供了但是空的按空处理，没提供的原样插入
      return value === '' ? '' : esc(n.raw)
    }
  }
}

/** VS Code 片段语法 → CodeMirror Snippet.parse 能读的模板 */
export function toCodeMirrorTemplate(body: string, vars: Partial<SnippetVariables>): string {
  const { nodes } = parseNodes(body, 0, false)
  const defaults = new Map<number, string>()
  collectDefaults(nodes, vars, defaults)
  defaults.delete(0)
  return nodes.map(n => renderNode(n, vars, false, defaults)).join('')
}
