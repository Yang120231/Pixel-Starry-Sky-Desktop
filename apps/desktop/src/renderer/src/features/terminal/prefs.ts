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

/** 终端字号（docs/ui/terminal-small-polish.md §2）：Ctrl+= / Ctrl+- 调，所有终端共用；没设（null）跟随界面字号 */
export const TERMINAL_FONT_SIZE_KEY = 'pixelsky.terminal.fontSize'
export const FONT_SIZE_MIN = 8
export const FONT_SIZE_MAX = 32

function readFontSize(): number | null {
  try {
    const value = Number(localStorage.getItem(TERMINAL_FONT_SIZE_KEY) || NaN)
    return Number.isInteger(value) && value >= FONT_SIZE_MIN && value <= FONT_SIZE_MAX ? value : null
  } catch {
    return null
  }
}

/** 放大 / 缩小一号后的字号：从当前实际字号（current，没设时是界面字号）起算，不超出 8～32 */
export const zoomedFontSize = (current: number, step: 1 | -1): number =>
  Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(current) + step))

const browser = typeof window !== 'undefined'
let state = {
  scrollback: browser ? readScrollback() : DEFAULT_SCROLLBACK,
  screenReader: browser ? readStoredFlag(TERMINAL_SCREEN_READER_KEY) : false,
  fontSize: browser ? readFontSize() : null,
}
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach(listener => listener())

function reload(): void {
  const next = {
    scrollback: readScrollback(),
    screenReader: readStoredFlag(TERMINAL_SCREEN_READER_KEY),
    fontSize: readFontSize(),
  }
  if (
    next.scrollback === state.scrollback &&
    next.screenReader === state.screenReader &&
    next.fontSize === state.fontSize
  )
    return
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

/** null：恢复跟随界面 */
export function setTerminalFontSize(next: number | null): void {
  if (next !== null && (!Number.isInteger(next) || next < FONT_SIZE_MIN || next > FONT_SIZE_MAX)) return
  if (next === state.fontSize) return
  state = { ...state, fontSize: next }
  if (next === null)
    try {
      localStorage.removeItem(TERMINAL_FONT_SIZE_KEY)
    } catch {
      /* 存储不可用时，本次仍然生效 */
    }
  else write(TERMINAL_FONT_SIZE_KEY, String(next))
  emit()
}

let stops: (() => void)[] = []
function subscribe(listener: () => void): () => void {
  if (!listeners.size)
    stops = [
      onStoredChange(TERMINAL_SCROLLBACK_KEY, reload),
      onStoredChange(TERMINAL_SCREEN_READER_KEY, reload),
      onStoredChange(TERMINAL_FONT_SIZE_KEY, reload),
    ]
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
