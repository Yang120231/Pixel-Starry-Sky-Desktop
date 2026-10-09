// 搜索演示数据只来自 demo.ts；正文仅属于明确有内容的默认演示会话。
import {
  compareSearchResults,
  containsTerms,
  itemSearchMatch,
  searchSnippet,
  searchTerms,
  titleMatch,
  type Item,
  type SearchQuery,
  type SearchResponse,
  type SearchResult,
} from '@pixelsky/protocol'
import { demo } from './demo'

export const demoSearchProjects = demo.projects.map(p => ({ id: p.id, name: p.name }))
const sessions = demo.projects.flatMap((p, pi) =>
  p.sessions.map((s, si) => ({
    sessionId: s.id,
    title: s.title,
    projectId: p.id,
    projectName: p.name,
    updatedAt: Date.UTC(2026, 9, 6, 10, 42) - (pi * 10 + si) * 60_000,
    engine: 'claude' as const,
  })),
)
const reply = demo.assistantReply
export const demoSearchItems: Item[] = [
  ...(reply
    ? [
        {
          kind: 'assistant' as const,
          id: 'demo-assistant',
          text: [reply.intro, ...reply.bullets.map(b => `${b.text}${b.bold ?? ''}${b.after ?? ''}`), reply.outro].join(
            '\n',
          ),
          status: 'completed' as const,
        },
      ]
    : []),
  ...demo.toolCalls.map(
    (c, i): Item =>
      c.kind === 'run'
        ? {
            kind: 'command',
            id: `demo-tool-${i}`,
            command: c.command,
            description: null,
            output: '',
            exitCode: c.ok ? 0 : 1,
            status: 'completed',
          }
        : {
            kind: 'file_change',
            id: `demo-tool-${i}`,
            changes: [{ path: c.path, diff: '', kind: 'update', added: c.added, removed: c.removed }],
            status: 'completed',
          },
  ),
]

export function searchDemo(q: SearchQuery): SearchResponse {
  const terms = searchTerms(q.text),
    records = sessions.filter(s => !q.projectId || s.projectId === q.projectId)
  const results: SearchResult[] = []
  for (const record of records) {
    const make = (match: NonNullable<ReturnType<typeof titleMatch>>, itemId: string | null): SearchResult => ({
      ...record,
      ...match,
      itemId,
      id: `${record.sessionId}:${itemId ?? 'title'}`,
    })
    if (!terms.length) {
      results.push(
        make({ kind: 'title', field: '最近会话', rank: 0, snippet: [{ text: record.title, match: false }] }, null),
      )
      continue
    }
    if (q.scope === 'all' || q.scope === 'titles') {
      const title = titleMatch(record.title, terms, q.text)
      if (title) results.push(make(title, null))
      else if (containsTerms(record.projectName, terms))
        results.push(
          make({ kind: 'project', field: '项目', rank: 3, snippet: searchSnippet(record.projectName, terms) }, null),
        )
    }
    if (record.sessionId === demo.defaultSessionId && q.scope !== 'titles')
      for (const item of demoSearchItems) {
        const match = itemSearchMatch(item, terms, q.scope)
        if (match) results.push(make(match, item.id))
      }
  }
  results.sort(compareSearchResults)
  return {
    requestId: q.requestId,
    results: results.slice(0, terms.length ? 50 : 10),
    partial: false,
    truncated: results.length > 50,
    sessionCount: records.length,
  }
}
