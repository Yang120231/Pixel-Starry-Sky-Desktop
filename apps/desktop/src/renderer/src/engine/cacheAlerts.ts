import type { CacheWarning, HostEvent } from '@pixelsky/protocol'

export interface CacheAlert { warning: CacheWarning; stopping: boolean; error?: string; errorExpiresAt?: number }
export interface CacheAlertState {
  cards: CacheAlert[]
  turns: Record<string, string | null>
  seen: Record<string, string>
}
export const emptyCacheAlerts = (): CacheAlertState => ({ cards: [], turns: {}, seen: {} })
export const cacheAlertId = (w: CacheWarning): string => `${w.sessionId}:${w.turnId}`

/** 使用事件原始截止时间，不因重复上报、切后台或刷新卡片而重新计时。 */
export function expireCacheAlerts(state: CacheAlertState, now: number): CacheAlertState {
  const cards = state.cards.filter(c => c.stopping || (c.errorExpiresAt ?? c.warning.expiresAt) > now)
  return cards.length === state.cards.length ? state : { ...state, cards }
}

export function applyCacheAlertEvent(state: CacheAlertState, event: HostEvent, now: number, enabled: boolean): CacheAlertState {
  state = expireCacheAlerts(state, now)
  if (event.kind === 'cache_warning') {
    const w = event.warning
    if (w.expiresAt <= now || state.seen[w.sessionId] === w.turnId || (w.sessionId in state.turns && state.turns[w.sessionId] !== w.turnId)) return state
    const seen = { ...state.seen, [w.sessionId]: w.turnId }
    const cards = enabled ? [...state.cards.filter(c => c.warning.sessionId !== w.sessionId), { warning: w, stopping: false }].slice(-3) : state.cards
    return { ...state, seen, cards }
  }
  if (event.kind === 'session') {
    const id = event.sessionId, e = event.event
    if (e.type === 'turn_started') return { ...state, turns: { ...state.turns, [id]: e.turnId }, cards: state.cards.filter(c => c.warning.sessionId !== id) }
    if (e.type === 'turn_completed') {
      const turns = state.turns[id] === e.turnId || !(id in state.turns) ? { ...state.turns, [id]: null } : state.turns
      return { ...state, turns, cards: state.cards.filter(c => c.warning.sessionId !== id || c.warning.turnId !== e.turnId) }
    }
    if (e.type === 'status' && e.state === 'idle') return { ...state, turns: { ...state.turns, [id]: null }, cards: state.cards.filter(c => c.warning.sessionId !== id) }
  }
  if (event.kind === 'sessions') {
    const ids = new Set(event.sessions.map(s => s.record.id))
    return { cards: state.cards.filter(c => ids.has(c.warning.sessionId)), turns: Object.fromEntries(Object.entries(state.turns).filter(([id]) => ids.has(id))), seen: Object.fromEntries(Object.entries(state.seen).filter(([id]) => ids.has(id))) }
  }
  return state
}
