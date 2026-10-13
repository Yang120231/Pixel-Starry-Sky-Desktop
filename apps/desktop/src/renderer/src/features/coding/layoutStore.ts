import { useSyncExternalStore } from 'react'
import {
  DEFAULT_CODING_LAYOUT,
  PANEL_LIMITS,
  clampPanel,
  parseCodingLayout,
  toggleBottomTab,
  toggleLeftView,
  toggleRightView,
} from './layoutModel'
import type { BottomTab, CodingLayoutPrefs, CodingPanel, LeftView, RightView } from './types'

const demo = typeof window !== 'undefined' && window.pixelsky?.demo === true
/** 演示模式用 + '.demo'（不进云同步，docs/ui/coding-mode-impl.md D6） */
export const CODING_LAYOUT_KEY = demo ? 'pixelsky.coding.layout.v1.demo' : 'pixelsky.coding.layout.v1'

function read(): CodingLayoutPrefs {
  if (typeof window === 'undefined') return DEFAULT_CODING_LAYOUT
  try {
    const raw = window.localStorage.getItem(CODING_LAYOUT_KEY)
    return raw === null ? DEFAULT_CODING_LAYOUT : parseCodingLayout(raw)
  } catch {
    return DEFAULT_CODING_LAYOUT
  }
}

let state: CodingLayoutPrefs = read()
const listeners = new Set<() => void>()

function persist(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CODING_LAYOUT_KEY, JSON.stringify(state))
  } catch {
    // 存储不可用时本次使用仍然有效
  }
}

/** 拖动中（save=false）只更新内存，松手时落盘，同 features/layout/sizes.ts */
function set(next: CodingLayoutPrefs, save = true): void {
  const changed = next !== state
  if (changed) state = next
  if (save) persist()
  if (changed) listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // 另一个窗口改了布局时跟着变
  window.addEventListener('storage', e => {
    if (e.key === CODING_LAYOUT_KEY)
      set(e.newValue === null ? DEFAULT_CODING_LAYOUT : parseCodingLayout(e.newValue), false)
  })
}

export function getCodingLayout(): CodingLayoutPrefs {
  return state
}
export function useCodingLayout(): CodingLayoutPrefs {
  return useSyncExternalStore(subscribe, getCodingLayout, getCodingLayout)
}

export const codingLayout = {
  toggle(panel: CodingPanel): void {
    codingLayout.setOpen(panel, !state[panel].open)
  },
  setOpen(panel: CodingPanel, open: boolean): void {
    if (state[panel].open === open) return
    set({ ...state, [panel]: { ...state[panel], open } })
  },
  /** 拖动中 persist=false，松手时 true */
  setSize(panel: CodingPanel, size: number, persist = false): void {
    const next = clampPanel(panel, size)
    if (state[panel].size === next) {
      if (persist) set(state)
      return
    }
    set({ ...state, [panel]: { ...state[panel], size: next } }, persist)
  },
  resetSize(panel: CodingPanel): void {
    codingLayout.setSize(panel, PANEL_LIMITS[panel].initial, true)
  },
  showLeft(view: LeftView): void {
    set({ ...state, left: { ...state.left, open: true, view } })
  },
  toggleLeft(view: LeftView): void {
    set(toggleLeftView(state, view))
  },
  showRight(view: RightView): void {
    set({ ...state, right: { ...state.right, open: true, view } })
  },
  toggleRight(view: RightView): void {
    set(toggleRightView(state, view))
  },
  showBottom(tab: BottomTab): void {
    set({ ...state, bottom: { ...state.bottom, open: true, tab } })
  },
  toggleBottom(tab?: BottomTab): void {
    set(toggleBottomTab(state, tab))
  },
  setBottomMaximized(value: boolean): void {
    if (state.bottom.maximized === value) return
    set({ ...state, bottom: { ...state.bottom, maximized: value } })
  },
}
