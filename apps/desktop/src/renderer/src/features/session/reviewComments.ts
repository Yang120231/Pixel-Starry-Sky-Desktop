// 代码评论（docs/ui/rewind-fork-sidechat.md §4）：按会话存在本机，攒起来一条消息交给 AI
import { useMemo, useSyncExternalStore } from 'react'
import { tr } from '@/i18n/core'
import type { DiffComment, DiffCommentsApi } from '@/ui/code/diffComments'

const STORAGE = 'pixelsky.review-comments'
type All = Record<string, DiffComment[]>

function load(): All {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '{}')
    if (!raw || typeof raw !== 'object') return {}
    const out: All = {}
    for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      const ok = list.filter(
        (c): c is DiffComment =>
          !!c &&
          typeof c === 'object' &&
          typeof (c as DiffComment).id === 'string' &&
          typeof (c as DiffComment).path === 'string' &&
          typeof (c as DiffComment).line === 'number' &&
          typeof (c as DiffComment).text === 'string' &&
          typeof (c as DiffComment).code === 'string' &&
          ((c as DiffComment).side === 'new' || (c as DiffComment).side === 'old'),
      )
      if (ok.length) out[id] = ok
    }
    return out
  } catch {
    return {}
  }
}

let all: All = typeof window === 'undefined' ? {} : load()
const listeners = new Set<() => void>()
const EMPTY: DiffComment[] = []

function save(next: All): void {
  all = next
  try {
    localStorage.setItem(STORAGE, JSON.stringify(all))
  } catch {
    // 当前窗口内仍保留
  }
  listeners.forEach(l => l())
}

function setSession(sessionId: string, list: DiffComment[]): void {
  const next = { ...all }
  if (list.length) next[sessionId] = list
  else delete next[sessionId]
  save(next)
}

export function reviewComments(sessionId: string): DiffComment[] {
  return all[sessionId] ?? EMPTY
}

export function clearReviewComments(sessionId: string): void {
  setSession(sessionId, [])
}

/** 这个会话的评论和给 DiffView 用的接口 */
export function useReviewComments(sessionId: string | null): { comments: DiffComment[]; api: DiffCommentsApi | null } {
  const comments = useSyncExternalStore(
    l => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => (sessionId ? reviewComments(sessionId) : EMPTY),
  )
  const api = useMemo<DiffCommentsApi | null>(
    () =>
      sessionId
        ? {
            list: path => reviewComments(sessionId).filter(c => c.path === path),
            add: c => setSession(sessionId, [...reviewComments(sessionId), { ...c, id: crypto.randomUUID() }]),
            update: (id, text) =>
              setSession(
                sessionId,
                reviewComments(sessionId).map(c => (c.id === id ? { ...c, text } : c)),
              ),
            remove: id =>
              setSession(
                sessionId,
                reviewComments(sessionId).filter(c => c.id !== id),
              ),
          }
        : null,
    // comments 变了也要换一个对象，让 DiffView 重新读 list
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, comments],
  )
  return { comments, api }
}

/** 交给 AI 的消息：按文件、行号排好，每条带上那一行代码 */
export function reviewMessage(comments: DiffComment[]): string {
  const sorted = [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
  const lines = [tr('review.messageIntro'), '']
  sorted.forEach((c, i) => {
    const where = c.side === 'old' ? tr('review.removedLine', { n: c.line }) : tr('review.line', { n: c.line })
    lines.push(`${i + 1}. ${c.path} ${where}`)
    if (c.code.trim()) lines.push(`   > ${c.code.trim()}`)
    for (const t of c.text.split('\n')) lines.push(`   ${t}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}
