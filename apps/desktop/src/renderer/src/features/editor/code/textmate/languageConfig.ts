import type { Extension } from '@codemirror/state'
import { indentService } from '@codemirror/language'

// VS Code 的 language-configuration.json → CodeMirror 的语言数据和缩进服务。纯函数，非法内容一律忽略

export interface LanguageDataSpec {
  commentTokens?: { line?: string; block?: { open: string; close: string } }
  closeBrackets?: { brackets: string[] }
  indent?: { increase?: RegExp; decrease?: RegExp }
}

const SUPPORTED = new Set(['comments', 'autoClosingPairs', 'indentationRules'])

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toRegExp(v: unknown): RegExp | undefined {
  // 规则可以是字符串，也可以是 { pattern, flags }
  const pattern = typeof v === 'string' ? v : isObject(v) && typeof v.pattern === 'string' ? v.pattern : null
  if (!pattern) return undefined
  try {
    return new RegExp(pattern, isObject(v) && typeof v.flags === 'string' ? v.flags : '')
  } catch {
    return undefined
  }
}

export function parseLanguageConfiguration(json: unknown): { data: LanguageDataSpec; ignored: string[] } {
  const data: LanguageDataSpec = {}
  const ignored: string[] = []
  if (!isObject(json)) return { data, ignored }
  for (const key of Object.keys(json)) if (!SUPPORTED.has(key)) ignored.push(key)

  const comments = json.comments
  if (isObject(comments)) {
    const tokens: NonNullable<LanguageDataSpec['commentTokens']> = {}
    if (typeof comments.lineComment === 'string' && comments.lineComment) tokens.line = comments.lineComment
    const block = comments.blockComment
    if (Array.isArray(block) && typeof block[0] === 'string' && typeof block[1] === 'string' && block[0] && block[1])
      tokens.block = { open: block[0], close: block[1] }
    if (tokens.line || tokens.block) data.commentTokens = tokens
  }

  if (Array.isArray(json.autoClosingPairs)) {
    const brackets: string[] = []
    for (const pair of json.autoClosingPairs) {
      const open = typeof pair === 'string' ? pair : Array.isArray(pair) ? pair[0] : isObject(pair) ? pair.open : null
      // CodeMirror 只认单个字符的开括号
      if (typeof open === 'string' && [...open].length === 1 && !brackets.includes(open)) brackets.push(open)
    }
    if (brackets.length) data.closeBrackets = { brackets }
  }

  const rules = json.indentationRules
  if (isObject(rules)) {
    const increase = toRegExp(rules.increaseIndentPattern)
    const decrease = toRegExp(rules.decreaseIndentPattern)
    if (increase || decrease) data.indent = { increase, decrease }
  }
  return { data, ignored }
}

/** 缩进：沿用上一个非空行的缩进，匹配 increase 的多一级，当前行匹配 decrease 的少一级；没配规则时不接管（返回 null） */
export function tmIndentService(data: LanguageDataSpec): Extension {
  const rules = data.indent
  if (!rules) return []
  return indentService.of((cx, pos) => {
    const doc = cx.state.doc
    const line = doc.lineAt(pos)
    const current = line.text
    let prev = null as string | null
    for (let n = line.number - 1; n >= 1; n--) {
      const l = doc.line(n)
      if (l.text.trim()) {
        prev = l.text
        break
      }
    }
    if (prev === null) return null
    let indent = /^\s*/.exec(prev)![0].replace(/\t/g, ' '.repeat(cx.unit)).length
    if (rules.increase?.test(prev)) indent += cx.unit
    if (rules.decrease?.test(current)) indent = Math.max(0, indent - cx.unit)
    return indent
  })
}
