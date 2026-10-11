// 把编辑器里选中的代码引用到对话（docs/ui/editor-quote.md）：算行范围、拼引用文字、查大小、认引用标题行。纯函数
import type { Text } from '@codemirror/state'

/** 一次最多引用多少行、多少字：再长就让智能体自己读文件，免得一条消息塞进整个文件 */
export const QUOTE_MAX_LINES = 500
export const QUOTE_MAX_CHARS = 40_000

export interface QuoteRange {
  startLine: number
  endLine: number
  /** 这几行的完整内容（从行首到行尾，保留缩进） */
  code: string
}

/**
 * 选区 → 引用的整行：拖选到下一行行首时那一行不算；没有选中时是光标所在的那一行。
 * 引用整行而不是选中的那几个字，缩进不会错位，行号也对得上
 */
export function quoteRange(doc: Text, from: number, to: number): QuoteRange {
  const first = doc.lineAt(Math.min(from, to))
  let last = doc.lineAt(Math.max(from, to))
  if (last.number > first.number && Math.max(from, to) === last.from) last = doc.line(last.number - 1)
  return { startLine: first.number, endLine: last.number, code: doc.sliceString(first.from, last.to) }
}

/** 超过上限时给出实际大小，没超过为 null */
export function quoteTooLong(range: QuoteRange): { lines: number; chars: number } | null {
  const lines = range.endLine - range.startLine + 1
  return lines > QUOTE_MAX_LINES || range.code.length > QUOTE_MAX_CHARS ? { lines, chars: range.code.length } : null
}

/** 代码块的语言标记：用扩展名（对话里的代码块按它高亮），Dockerfile 这类没有扩展名的用文件名 */
export function fenceLanguage(path: string): string {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (/^(docker|container)file(\..+)?$/.test(name)) return 'dockerfile'
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : ''
}

/** 引用标题行里的行号：一行写 L12，多行写 L12-18 */
export const lineHash = (startLine: number, endLine: number): string =>
  startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`

/**
 * 引用文字：第一行是「路径#L12-18」，下面是这几行代码的代码块。
 * 不用 @路径：Claude Code 会把 @路径#L12-18 自己读出来附上，代码就发了两遍，而且读的是磁盘上的、不含没保存的修改；
 * Codex 不认 @。代码块里的反引号比代码里最长的一串还多一个，代码里有 ``` 也不会提前结束
 */
export function quoteText(path: string, range: QuoteRange): string {
  const longest = Math.max(0, ...(range.code.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${path}#${lineHash(range.startLine, range.endLine)}\n${fence}${fenceLanguage(path)}\n${range.code}\n${fence}`
}

/** 一整行是引用标题（路径#L12 或 路径#L12-18，路径里没有空白）时给出路径部分和行号，否则 null */
export function quoteHeading(line: string): { path: string; startLine: number; endLine: number } | null {
  const m = /^([^\s@#]+)#L(\d+)(?:-L?(\d+))?$/.exec(line)
  if (!m) return null
  const startLine = Number(m[2])
  return { path: m[1], startLine, endLine: m[3] ? Math.max(startLine, Number(m[3])) : startLine }
}

/**
 * 引用里写的路径：目标会话就在这个文件所在的目录里（或者新任务还不知道在哪）时写相对路径，
 * 否则写绝对路径，免得智能体在自己的项目里找同名文件
 */
export function quotePath(file: { root: string; path: string }, cwd: string | null): string {
  if (!cwd || !file.root) return file.path
  const slash = (p: string) => p.replaceAll('\\', '/').replace(/\/+$/, '')
  return slash(cwd).toLowerCase() === slash(file.root).toLowerCase() ? file.path : `${slash(file.root)}/${file.path}`
}
