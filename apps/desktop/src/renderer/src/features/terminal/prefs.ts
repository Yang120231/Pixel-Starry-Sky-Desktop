// 终端的本机偏好（docs/perf-audit-2026-10-18.md D6）：回滚行数、读屏支持，保存在本机，多窗口同步，改了马上作用到开着的终端。
// 原来每个终端固定 1 万行回滚、读屏模式常开（跑满约 14 MB 一个，读屏模式还要多维护一份无障碍文字树）
import { useSyncExternalStore } from 'react'
import { onStoredChange, readStoredFlag } from '@/features/settings/storedValue'

export type ScrollbackChoice = '1000' | '3000' | '10000'
export const TERMINAL_SCROLLBACK_KEY = 'pixelsky.terminal.scrollback'
export const TERMINAL_SCREEN_READER_KEY = 'pixelsky.terminal.screenReader'
export const DEFAULT_SCROLLBACK: ScrollbackChoice = '3000'
export const SCROLLBACK_CHOICES: readonly ScrollbackChoice[] = ['1000', '3000', '10000']

const valid = (v: unknown): v is ScrollbackChoice => SCROLLBACK_CHOICES.includes(v as ScrollbackChoice)

function readScrollback(): ScrollbackChoice {
  try {
    const value = localStorage.getItem(TERMINAL_SCROLLBACK_KEY)
    return valid(value) ? value : DEFAULT_SCROLLBACK
  } catch {
    return DEFAULT_SCROLLBACK
  }
}

const browser = typeof window !== 'undefined'
let state = {
  scrollback: browser ? readScrollback() : DEFAULT_SCROLLBACK,
  screenReader: browser ? readStoredFlag(TERMINAL_SCREEN_READER_KEY) : false,
}
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach(listener => listener())

function reload(): void {
  const next = { scrollback: readScrollback(), screenReader: readStoredFlag(TERMINAL_SCREEN_READER_KEY) }
  if (next.scrollback === state.scrollback && next.screenReader === state.screenReader) return
  state = next
  emit()
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 存储不可用时，本次仍然生效 */
  }
}

export function setTerminalScrollback(next: ScrollbackChoice): void {
  if (!valid(next) || next === state.scrollback) return
  state = { ...state, scrollback: next }
  write(TERMINAL_SCROLLBACK_KEY, next)
  emit()
}

export function setTerminalScreenReader(next: boolean): void {
  if (next === state.screenReader) return
  state = { ...state, screenReader: next }
  write(TERMINAL_SCREEN_READER_KEY, String(next))
  emit()
}

let stops: (() => void)[] = []
function subscribe(listener: () => void): () => void {
  if (!listeners.size)
    stops = [onStoredChange(TERMINAL_SCROLLBACK_KEY, reload), onStoredChange(TERMINAL_SCREEN_READER_KEY, reload)]
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) stops.splice(0).forEach(stop => stop())
  }
}

export const terminalPrefs = (): typeof state => state

export function useTerminalPrefs(): typeof state {
  return useSyncExternalStore(subscribe, terminalPrefs, terminalPrefs)
}
