// 滚动条上显示轮次（docs/ui/turn-rail.md §3、§8）：保存在本机，多窗口同步。
// 2026-10-13 起刻度和滚动条合成一条、只在右边：存的值沿用原来的 left / right / off，left、right 都算「显示」
import { useSyncExternalStore } from 'react'

export type TurnRailSide = 'left' | 'right' | 'off'
export const TURN_RAIL_KEY = 'pixelsky.turn-rail'
export const DEFAULT_TURN_RAIL: TurnRailSide = 'right'

const valid = (v: unknown): v is TurnRailSide => v === 'left' || v === 'right' || v === 'off'

function read(): TurnRailSide {
  try {
    const value = localStorage.getItem(TURN_RAIL_KEY)
    return valid(value) ? value : DEFAULT_TURN_RAIL
  } catch {
    return DEFAULT_TURN_RAIL
  }
}

let side: TurnRailSide = typeof window === 'undefined' ? DEFAULT_TURN_RAIL : read()
const listeners = new Set<() => void>()

export function setTurnRailSide(next: TurnRailSide): void {
  if (!valid(next) || next === side) return
  side = next
  try {
    localStorage.setItem(TURN_RAIL_KEY, side)
  } catch {
    /* 存储不可用时，本次仍然生效 */
  }
  listeners.forEach(listener => listener())
}

function onStorage(event: StorageEvent): void {
  if (event.storageArea !== localStorage || (event.key !== TURN_RAIL_KEY && event.key !== null)) return
  const next = read()
  if (next === side) return
  side = next
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void): () => void {
  if (!listeners.size) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener('storage', onStorage)
  }
}

export function useTurnRailSide(): TurnRailSide {
  return useSyncExternalStore(
    subscribe,
    () => side,
    () => DEFAULT_TURN_RAIL,
  )
}

/** 显示轮次刻度（原来选左侧、右侧的都算） */
export function useTurnRailOn(): boolean {
  return useTurnRailSide() !== 'off'
}
