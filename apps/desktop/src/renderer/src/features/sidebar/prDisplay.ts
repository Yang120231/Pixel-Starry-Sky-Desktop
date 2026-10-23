// 侧栏 PR 图标显示哪些（docs/ui/sidebar-pr-v2-mockup.html）：只在悬停卡里改，不进设置页，存 localStorage。
// hiddenPrs：隐藏了图标的 PR（所有对话都不显示）；hiddenSessions：不显示 PR 图标的对话；
// doneDays：合并、关闭后显示几天（0 不显示，-1 一直）；openMode：开着的 PR 都显示 / 只显示要处理的（检查没过、有冲突）
import { useSyncExternalStore } from 'react'

export type DoneDays = 0 | 1 | 7 | -1
export type OpenMode = 'all' | 'attention'

export interface PrDisplay {
  hiddenPrs: string[]
  hiddenSessions: string[]
  doneDays: DoneDays
  openMode: OpenMode
}

export const PR_DISPLAY_KEY = 'pixelsky.sidebar.prDisplay'
export const DONE_DAYS: readonly DoneDays[] = [0, 1, 7, -1]
export const DEFAULT_PR_DISPLAY: PrDisplay = { hiddenPrs: [], hiddenSessions: [], doneDays: 1, openMode: 'all' }
/** 隐藏的记录各最多留这么多，新的挤掉旧的 */
const MAX_HIDDEN = 300

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s).slice(-MAX_HIDDEN) : []

export function parsePrDisplay(raw: unknown): PrDisplay {
  if (!raw || typeof raw !== 'object') return DEFAULT_PR_DISPLAY
  const v = raw as Record<string, unknown>
  return {
    hiddenPrs: strings(v.hiddenPrs).map(u => u.toLowerCase()),
    hiddenSessions: strings(v.hiddenSessions),
    doneDays: DONE_DAYS.includes(v.doneDays as DoneDays) ? (v.doneDays as DoneDays) : DEFAULT_PR_DISPLAY.doneDays,
    openMode: v.openMode === 'attention' ? 'attention' : 'all',
  }
}

function read(): PrDisplay {
  try {
    const text = localStorage.getItem(PR_DISPLAY_KEY)
    return text ? parsePrDisplay(JSON.parse(text)) : DEFAULT_PR_DISPLAY
  } catch {
    return DEFAULT_PR_DISPLAY
  }
}

let state: PrDisplay | null = null
const listeners = new Set<() => void>()
const current = (): PrDisplay => (state ??= read())

function set(next: PrDisplay): void {
  state = next
  try {
    localStorage.setItem(PR_DISPLAY_KEY, JSON.stringify(next))
  } catch {
    /* 存不了就只在这次打开里生效 */
  }
  listeners.forEach(fn => fn())
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

export function usePrDisplay(): PrDisplay {
  return useSyncExternalStore(subscribe, current, () => DEFAULT_PR_DISPLAY)
}

const without = (list: string[], items: readonly string[]): string[] => list.filter(x => !items.includes(x))

export const prDisplay = {
  get: current,
  /** 隐藏这些 PR 的图标（所有对话） */
  hide(urls: readonly string[]): void {
    const keys = urls.map(u => u.toLowerCase())
    set({ ...current(), hiddenPrs: [...without(current().hiddenPrs, keys), ...keys].slice(-MAX_HIDDEN) })
  },
  /** 放回这些 PR 的图标 */
  show(urls: readonly string[]): void {
    set({
      ...current(),
      hiddenPrs: without(
        current().hiddenPrs,
        urls.map(u => u.toLowerCase()),
      ),
    })
  },
  /** 这个对话不显示 / 恢复显示 PR 图标 */
  setSessionHidden(sessionId: string, hidden: boolean): void {
    const list = without(current().hiddenSessions, [sessionId])
    set({ ...current(), hiddenSessions: hidden ? [...list, sessionId].slice(-MAX_HIDDEN) : list })
  },
  setDoneDays(doneDays: DoneDays): void {
    set({ ...current(), doneDays })
  },
  setOpenMode(openMode: OpenMode): void {
    set({ ...current(), openMode })
  },
}
