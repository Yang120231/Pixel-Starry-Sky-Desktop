// 全局搜索结果按会话合并（docs/ui/conversation-ux-2.md §2.5）：同一会话的标题、消息、工具命中合成一行，
// 顺序按会话里排名最高的那一处；项目、手动任务各自一行。
import { matchRanges, type SearchFragment, type SearchResult } from '@pixelsky/protocol'

export interface ResultGroup {
  key: string
  /** 这一行的摘要和回车打开的那一处：优先对话内容的命中（标题这一行已经显示了） */
  head: SearchResult
  /** 其它命中，原来的顺序；展开后列在下面 */
  rest: SearchResult[]
  /** 这一行代表几处对话内容命中（head 加其它）：搜索每个会话最多只带最近 3 处，总数用 sessionMatches（旧版远端没有时按带回来的算） */
  total: number
}

export function groupResults(results: readonly SearchResult[]): ResultGroup[] {
  const groups = new Map<string, SearchResult[]>()
  for (const r of results) {
    const key = r.sessionId && !r.id.startsWith('manual-task:') ? `session:${r.sessionId}` : r.id
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }
  return [...groups].map(([key, hits]) => {
    // 标题命中已经在这一行的标题上标出来了，不再单列、不计数
    const head = hits.find(h => h.itemId !== null) ?? hits[0]
    if (head.itemId === null) return { key, head, rest: [], total: 1 }
    const rest = hits.filter(h => h !== head && h.itemId !== null)
    const total = Math.max(rest.length + 1, ...hits.map(h => h.sessionMatches ?? 0))
    return { key, head, rest, total }
  })
}

/** 标题里标出命中词（terms 已按 searchTerms 折叠） */
export function titleFragments(title: string, terms: readonly string[]): SearchFragment[] {
  const out: SearchFragment[] = []
  let at = 0
  for (const [a, b] of matchRanges(title, terms)) {
    if (a > at) out.push({ text: title.slice(at, a), match: false })
    out.push({ text: title.slice(a, b), match: true })
    at = b
  }
  if (at < title.length) out.push({ text: title.slice(at), match: false })
  return out
}
