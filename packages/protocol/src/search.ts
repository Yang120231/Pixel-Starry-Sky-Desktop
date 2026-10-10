import type { EngineId, Item } from './types'

export const SEARCH_SCOPES = ['all', 'titles', 'messages', 'tools'] as const
export type SearchScope = (typeof SEARCH_SCOPES)[number]
export interface SearchQuery {
  requestId: number
  text: string
  scope: SearchScope
  projectId: string | null
}
export type SearchKind =
  | 'title'
  | 'project'
  | 'user'
  | 'assistant'
  | 'notice'
  | 'command'
  | 'tool'
  | 'file_change'
  | 'todo'
export interface SearchFragment {
  text: string
  match: boolean
}
export interface SearchResult {
  id: string
  sessionId: string
  itemId: string | null
  kind: SearchKind
  field: string
  title: string
  projectId: string
  projectName: string
  engine: EngineId
  updatedAt: number
  snippet: SearchFragment[]
  rank: number
  /**
   * 这个会话一共有几处对话内容命中（结果里每个会话最多只带最近 3 处，界面按会话合并时显示总数，
   * docs/ui/conversation-ux-2.md §2.5）。标题、项目命中和旧版远端没有
   */
  sessionMatches?: number
}
export interface SearchResponse {
  requestId: number
  results: SearchResult[]
  truncated: boolean
  partial: boolean
  sessionCount: number
  cancelled?: boolean
}
export interface SearchMatch {
  kind: SearchKind
  field: string
  snippet: SearchFragment[]
  rank: number
}

// 英文大小写折叠不改变字符串长度，中文、路径与符号保留原样。
const fold = (s: string) => s.replace(/[A-Z]/g, c => c.toLowerCase())
export const searchTerms = (text: string): string[] => [...new Set(fold(text.trim()).split(/\s+/).filter(Boolean))]
export const containsTerms = (text: string, terms: readonly string[]): boolean =>
  terms.every(term => fold(text).includes(term))

/** 一个字面搜索词按同样的规则折叠（对话内搜索按整段字面查找，不拆词） */
export const searchLiteral = (text: string): string => fold(text.trim())

/**
 * 关键词（已折叠，见 searchTerms / searchLiteral）在原文 [from, to) 里的命中区间，按位置排好、重叠的合并。
 * 全局搜索的摘要、跳转后的命中标记、对话内搜索共用（docs/ui/content-highlight.md §2 E）。
 */
export function matchRanges(
  text: string,
  terms: readonly string[],
  from = 0,
  to = text.length,
): Array<[number, number]> {
  const normalized = fold(text)
  const ranges: Array<[number, number]> = []
  for (const term of terms) {
    if (!term) continue
    let at = normalized.indexOf(term, from)
    while (at >= 0 && at < to) {
      ranges.push([at, Math.min(to, at + term.length)])
      at = normalized.indexOf(term, at + term.length)
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const r of ranges) {
    const last = merged.at(-1)
    if (last && last[1] >= r[0]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  return merged
}

/** 用原文字片段高亮，关键词永远是字面文本。 */
export function searchSnippet(text: string, terms: readonly string[], limit = 180): SearchFragment[] {
  if (!text) return []
  const normalized = fold(text)
  const first = Math.min(...terms.map(t => normalized.indexOf(t)).filter(i => i >= 0))
  const start = Number.isFinite(first) ? Math.max(0, first - 48) : 0
  const end = Math.min(text.length, start + limit)
  const merged = matchRanges(text, terms, start, end)
  const out: SearchFragment[] = start ? [{ text: '…', match: false }] : []
  let at = start
  for (const [a, b] of merged) {
    if (a > at) out.push({ text: text.slice(at, a), match: false })
    out.push({ text: text.slice(a, b), match: true })
    at = b
  }
  if (at < end) out.push({ text: text.slice(at, end), match: false })
  if (end < text.length) out.push({ text: '…', match: false })
  return out
}

export function titleMatch(title: string, terms: readonly string[], query: string): SearchMatch | null {
  if (!containsTerms(title, terms)) return null
  const normalized = fold(title),
    text = fold(query.trim())
  return {
    kind: 'title',
    field: '会话标题',
    rank: normalized === text ? 0 : normalized.startsWith(text) ? 1 : 2,
    snippet: searchSnippet(title, terms),
  }
}

/** 只返回一条目的一个命中字段，已完成条目的重复版本由存储层去重。 */
export function itemSearchMatch(item: Item, terms: readonly string[], scope: SearchScope): SearchMatch | null {
  const fields: Array<[string, unknown]> = []
  let kind: SearchKind
  if (scope === 'all' || scope === 'messages') {
    if (item.kind === 'user' || item.kind === 'assistant' || item.kind === 'notice') {
      kind = item.kind
      fields.push([item.kind === 'user' ? '用户消息' : item.kind === 'assistant' ? '助手回复' : '系统提示', item.text])
    } else if (scope === 'messages') return null
    else kind = 'tool'
  } else kind = 'tool'
  if (scope === 'all' || scope === 'tools') {
    if (item.kind === 'command') {
      kind = 'command'
      fields.push(['命令', item.command], ['命令说明', item.description], ['命令输出', item.output])
    } else if (item.kind === 'tool') {
      kind = 'tool'
      fields.push(['工具摘要', item.title], ['工具名称', item.name], ['工具输出', item.output])
    } else if (item.kind === 'file_change') {
      kind = 'file_change'
      for (const change of Array.isArray(item.changes) ? item.changes : [])
        fields.push(['修改路径', change.path], ['文件改动', change.diff])
    } else if (item.kind === 'todo') {
      kind = 'todo'
      fields.push(['待办', Array.isArray(item.steps) ? item.steps.map(s => s.text).join('\n') : ''])
    }
  }
  for (const [field, value] of fields) {
    if (typeof value === 'string' && value && containsTerms(value, terms))
      return { kind, field, rank: 4, snippet: searchSnippet(value, terms) }
  }
  return null
}

export const compareSearchResults = (a: SearchResult, b: SearchResult): number =>
  a.rank - b.rank || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
