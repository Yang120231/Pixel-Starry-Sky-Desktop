// 会话评论（docs/ui/channels-collab-v2.md §7）：对某一轮（可以引用其中一段）写评论，交给 AI 改、交给频道成员，或标为解决。
// 按会话存在本机，和代码评论（reviewComments.ts）同一种存法，不同步到团队
import { useSyncExternalStore } from 'react'
import type { Item } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'

export interface TurnComment {
  id: string
  /** 这一轮结束时的统计行 id（turn_stats），和对话里「复制这一轮回复」用的同一个 */
  turnKey: string
  /** 第几轮（从 1 数），写进交给 AI 的消息里 */
  turn: number
  /** 引用的一段，没有为空串 */
  quote: string
  text: string
  at: number
  resolved: boolean
  /** 交给谁了：ai = 这个会话；channel = 频道成员（写频道名和成员名） */
  handedTo?: { kind: 'ai' } | { kind: 'channel'; channel: string; member: string } | null
}

const STORAGE = 'pixelsky.turn-comments'
/** 引用太长时截断：评论里只要能认出是哪段 */
export const QUOTE_LIMIT = 2000
type All = Record<string, TurnComment[]>

const valid = (c: unknown): c is TurnComment => {
  const x = c as TurnComment
  return (
    !!x &&
    typeof x === 'object' &&
    typeof x.id === 'string' &&
    typeof x.turnKey === 'string' &&
    typeof x.turn === 'number' &&
    typeof x.quote === 'string' &&
    typeof x.text === 'string' &&
    typeof x.at === 'number'
  )
}

function load(): All {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '{}')
    if (!raw || typeof raw !== 'object') return {}
    const out: All = {}
    for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      const ok = list.filter(valid).map(c => ({ ...c, resolved: !!c.resolved }))
      if (ok.length) out[id] = ok
    }
    return out
  } catch {
    return {}
  }
}

let all: All = typeof window === 'undefined' ? {} : load()
const listeners = new Set<() => void>()
const EMPTY: TurnComment[] = []

function save(next: All): void {
  all = next
  try {
    localStorage.setItem(STORAGE, JSON.stringify(all))
  } catch {
    // 当前窗口内仍保留
  }
  listeners.forEach(l => l())
}

function setSession(sessionId: string, list: TurnComment[]): void {
  const next = { ...all }
  if (list.length) next[sessionId] = list
  else delete next[sessionId]
  save(next)
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

// 别的窗口（设置窗口、分离的面板）改了也跟着变
if (typeof window !== 'undefined')
  window.addEventListener('storage', e => {
    if (e.key !== STORAGE) return
    all = load()
    listeners.forEach(l => l())
  })

export const turnComments = (sessionId: string): TurnComment[] => all[sessionId] ?? EMPTY

export function useTurnComments(sessionId: string | null): TurnComment[] {
  return useSyncExternalStore(subscribe, () => (sessionId ? turnComments(sessionId) : EMPTY))
}

export function addTurnComment(
  sessionId: string,
  input: { turnKey: string; turn: number; quote: string; text: string },
): TurnComment {
  const comment: TurnComment = {
    id: crypto.randomUUID(),
    turnKey: input.turnKey,
    turn: input.turn,
    quote: input.quote.trim().slice(0, QUOTE_LIMIT),
    text: input.text.trim(),
    at: Date.now(),
    resolved: false,
  }
  setSession(sessionId, [...turnComments(sessionId), comment])
  return comment
}

export function updateTurnComment(sessionId: string, id: string, patch: Partial<Omit<TurnComment, 'id'>>): void {
  setSession(
    sessionId,
    turnComments(sessionId).map(c => (c.id === id ? { ...c, ...patch } : c)),
  )
}

export function removeTurnComment(sessionId: string, id: string): void {
  setSession(
    sessionId,
    turnComments(sessionId).filter(c => c.id !== id),
  )
}

// ── 正在写的评论（一个会话同时只开一个评论框） ──

export interface TurnCommentDraft {
  sessionId: string
  turnKey: string
  turn: number
  quote: string
  /** 每次打开加一：同一轮再点一次也重新聚焦 */
  token: number
}
let draft: TurnCommentDraft | null = null
const draftListeners = new Set<() => void>()

export function openTurnComment(input: Omit<TurnCommentDraft, 'token'>): void {
  draft = { ...input, quote: input.quote.trim().slice(0, QUOTE_LIMIT), token: (draft?.token ?? 0) + 1 }
  draftListeners.forEach(l => l())
}

export function closeTurnComment(): void {
  if (!draft) return
  draft = null
  draftListeners.forEach(l => l())
}

export function useTurnCommentDraft(): TurnCommentDraft | null {
  return useSyncExternalStore(
    l => {
      draftListeners.add(l)
      return () => draftListeners.delete(l)
    },
    () => draft,
  )
}

// ── 纯函数 ──

/** 开启新一轮的用户消息：中途插入的引导、断线重连自动发的「继续」都接着原来那一轮 */
const startsTurn = (item: Item): boolean =>
  item.kind === 'user' && item.mode !== 'guidance' && item.reconnect === undefined

/**
 * 每一轮的统计行 id → 第几轮：按用户发的消息数（和检查点面板的 #N 一致）。
 * 没有统计行的轮次（进程意外退出、强制停止）也算数；断线重连的一轮有两个统计行，编号相同
 */
export function turnNumbers(items: readonly Item[]): Map<string, number> {
  const map = new Map<string, number>()
  let turn = 0
  for (const item of items) {
    if (startsTurn(item)) turn++
    else if (item.kind === 'turn_stats') map.set(item.id, Math.max(turn, 1))
  }
  return map
}

/**
 * 评论里存的 turn 是写评论那会儿的编号；编号规则改过（旧：按统计行数，新：按用户消息数），旧评论不会自己迁移。
 * 显示和发给 AI / 频道前按 turnKey 在当前 items 里重新算；对不上（这一轮的统计行已不在）时保留存的数字
 */
export function withCurrentTurns(comments: readonly TurnComment[], items: readonly Item[]): TurnComment[] {
  const numbers = turnNumbers(items)
  return comments.map(c => {
    const turn = numbers.get(c.turnKey) ?? c.turn
    return turn === c.turn ? c : { ...c, turn }
  })
}

/** 右侧面板里列出的评论：编号按当前对话重算，再按轮次、时间排；onlyOpen 时去掉已解决的。items 为 undefined（会话没加载）时用存的编号 */
export function panelComments(
  comments: readonly TurnComment[],
  items: readonly Item[] | undefined,
  onlyOpen: boolean,
): TurnComment[] {
  const current = items ? withCurrentTurns(comments, items) : [...comments]
  return current.filter(c => !onlyOpen || !c.resolved).sort((a, b) => a.turn - b.turn || a.at - b.at)
}

/**
 * 某条消息属于哪一轮：往后找这一轮里的统计行，不越过下一条用户消息。
 * 还在进行、或者没有统计行就结束了的一轮（进程意外退出、强制停止），评论没地方放，返回 null
 */
export function turnOfItem(items: readonly Item[], itemId: string): { turnKey: string; turn: number } | null {
  const start = items.findIndex(i => i.id === itemId)
  if (start < 0) return null
  let turn = 0
  for (let i = 0; i <= start; i++) if (startsTurn(items[i])) turn++
  for (let i = start; i < items.length; i++) {
    if (i > start && startsTurn(items[i])) return null
    if (items[i].kind === 'turn_stats') return { turnKey: items[i].id, turn: Math.max(turn, 1) }
  }
  return null
}

const quoted = (text: string): string =>
  text
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')

/** 交给 AI 的消息：「关于第 N 轮：」+ 引用 + 评论 */
export function commentMessage(c: Pick<TurnComment, 'turn' | 'quote' | 'text'>): string {
  const parts = [tr('turnComment.about', { n: c.turn })]
  if (c.quote) parts.push(quoted(c.quote))
  parts.push(c.text)
  return parts.join('\n\n')
}

/** 交给频道成员的要求：@ 成员，写清是哪个会话的第几轮 */
export function channelRequest(c: Pick<TurnComment, 'turn' | 'quote' | 'text'>, member: string, title: string): string {
  const parts = [
    `@${member} ${tr('turnComment.channelAbout', { title: title || tr('turnComment.untitled'), n: c.turn })}`,
  ]
  if (c.quote) parts.push(quoted(c.quote))
  parts.push(c.text)
  return parts.join('\n\n')
}
