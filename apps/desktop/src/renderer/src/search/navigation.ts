import { useSyncExternalStore } from 'react'

export interface ItemNavigation { sessionId: string; itemId: string; token: number }
let target: ItemNavigation | null = null
let sequence = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function navigateToItem(sessionId: string, itemId: string): void { target = { sessionId, itemId, token: ++sequence }; emit() }
export function finishItemNavigation(token: number): void { if (target?.token === token) { target = null; emit() } }
export function useItemNavigation(): ItemNavigation | null { return useSyncExternalStore(subscribe, () => target) }
