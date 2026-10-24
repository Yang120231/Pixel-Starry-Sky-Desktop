// 产物面板的伸缩（docs/ui/artifacts-panel.md §9）：「改动」的会话卡片和每一轮、「交付」的会话卡片都能收起。
// 默认：会话都展开，每个会话只展开最新的一轮；用户点过的记下来（按项目存在本机，不进云同步），新来的一轮默认展开。
import type { ArtifactDelivery, ArtifactTurn } from '@pixelsky/protocol'
import type { SessionGroup } from './artifactsModel'
import { turnKey } from './focus'

export interface FoldState {
  /** 「改动」里收起的会话 */
  closed: string[]
  /** 用户点过的轮：turnKey → 展开 / 收起；没点过的按默认（最新一轮展开） */
  turns: Record<string, boolean>
  /** 「交付」里收起的会话 */
  closedDelivered: string[]
}

export const EMPTY_FOLD: FoldState = { closed: [], turns: {}, closedDelivered: [] }

/** 一轮改了这么多文件以上时先列这么多，下面「还有 N 个文件」 */
export const TURN_FILES_MAX = 8
/** 一个会话交付了这么多以上时先列这么多 */
export const DELIVERED_MAX = 5
/** 记下的条目上限：太多时丢掉最早记的（会话、轮次删了也不会一直攒着） */
const KEEP = 300

/** 从本机读出来的值可能是旧的或被改坏的：不对的字段当没有 */
export function readFold(raw: unknown): FoldState {
  const o = (raw ?? {}) as Partial<FoldState>
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const turns: Record<string, boolean> = {}
  if (o.turns && typeof o.turns === 'object')
    for (const [k, v] of Object.entries(o.turns)) if (typeof v === 'boolean') turns[k] = v
  return { closed: strings(o.closed), turns, closedDelivered: strings(o.closedDelivered) }
}

const cap = <T>(list: T[]): T[] => (list.length > KEEP ? list.slice(list.length - KEEP) : list)
const capTurns = (turns: Record<string, boolean>): Record<string, boolean> => {
  const entries = Object.entries(turns)
  return entries.length > KEEP ? Object.fromEntries(entries.slice(entries.length - KEEP)) : turns
}
const toggleIn = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter(x => x !== id) : cap([...list, id])

export const sessionOpen = (s: FoldState, sessionId: string): boolean => !s.closed.includes(sessionId)
export const deliveredOpen = (s: FoldState, sessionId: string): boolean => !s.closedDelivered.includes(sessionId)

/** 这一轮展开没有：点过就按点的，没点过只有会话里最新的一轮展开（group.turns 已按时间倒序） */
export function turnOpen(s: FoldState, group: Pick<SessionGroup, 'turns'>, turn: ArtifactTurn): boolean {
  return s.turns[turnKey(turn)] ?? group.turns[0] === turn
}

export const toggleSession = (s: FoldState, sessionId: string): FoldState => ({
  ...s,
  closed: toggleIn(s.closed, sessionId),
})

export const toggleDelivered = (s: FoldState, sessionId: string): FoldState => ({
  ...s,
  closedDelivered: toggleIn(s.closedDelivered, sessionId),
})

export function toggleTurn(s: FoldState, group: Pick<SessionGroup, 'turns'>, turn: ArtifactTurn): FoldState {
  const key = turnKey(turn)
  const { [key]: _, ...rest } = s.turns
  return { ...s, turns: capTurns({ ...rest, [key]: !turnOpen(s, group, turn) }) }
}

/** 「全部展开」：会话和其中每一轮都展开 */
export function expandAll(s: FoldState, groups: readonly SessionGroup[]): FoldState {
  const ids = new Set(groups.map(g => g.sessionId))
  const turns = { ...s.turns }
  for (const g of groups) for (const t of g.turns) turns[turnKey(t)] = true
  return { ...s, closed: s.closed.filter(id => !ids.has(id)), turns: capTurns(turns) }
}

/** 「全部收起」：只剩会话标题（各轮记的状态不动，再展开会话时照旧） */
export function collapseAll(s: FoldState, groups: readonly SessionGroup[]): FoldState {
  const ids = groups.map(g => g.sessionId)
  return { ...s, closed: cap([...s.closed.filter(id => !ids.includes(id)), ...ids]) }
}

export function expandAllDelivered(s: FoldState, sessionIds: readonly string[]): FoldState {
  return { ...s, closedDelivered: s.closedDelivered.filter(id => !sessionIds.includes(id)) }
}

export function collapseAllDelivered(s: FoldState, sessionIds: readonly string[]): FoldState {
  return { ...s, closedDelivered: cap([...s.closedDelivered.filter(id => !sessionIds.includes(id)), ...sessionIds]) }
}

/** 「审查」定位到这一轮：它和所在的会话都展开 */
export function revealTurn(s: FoldState, turn: ArtifactTurn): FoldState {
  return {
    ...s,
    closed: s.closed.filter(id => id !== turn.sessionId),
    turns: capTurns({ ...s.turns, [turnKey(turn)]: true }),
  }
}

export interface DeliveredGroup {
  sessionId: string
  title: string
  at: number
  items: ArtifactDelivery[]
}

/** 交付按会话分组：会话按最近交付的时间倒序，组内也倒序 */
export function groupDelivered(items: readonly ArtifactDelivery[]): DeliveredGroup[] {
  const groups = new Map<string, DeliveredGroup>()
  for (const item of items) {
    const g = groups.get(item.sessionId) ?? { sessionId: item.sessionId, title: item.title, at: item.at, items: [] }
    g.items.push(item)
    g.at = Math.max(g.at, item.at)
    groups.set(item.sessionId, g)
  }
  for (const g of groups.values()) g.items.sort((a, b) => b.at - a.at)
  return [...groups.values()].sort((a, b) => b.at - a.at)
}

/** 一组轮次的文件数和增删行数（收起时那一行的摘要） */
export function turnsSummary(turns: readonly ArtifactTurn[]): { files: number; added: number; removed: number } {
  let files = 0,
    added = 0,
    removed = 0
  for (const t of turns)
    for (const f of t.files) {
      files++
      added += f.added
      removed += f.removed
    }
  return { files, added, removed }
}
