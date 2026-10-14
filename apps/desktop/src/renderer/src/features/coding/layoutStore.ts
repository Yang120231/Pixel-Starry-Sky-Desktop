import { useSyncExternalStore } from 'react'
import {
  DEFAULT_CODING_LAYOUT,
  PANEL_LIMITS,
  clampPanel,
  parseCodingLayout,
  toggleBottomTab,
  toggleLeftView,
  toggleRightView,
  type CodingFit,
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

/**
 * 不落盘的两个标记（docs/ui/coding-mode-impl.md §3.2）：
 * keepLeft——用户主动打开左栏后，窗口窄时左栏只压不藏、改压右栏；关左栏时清掉。
 * fitLeftHidden——左栏开着但这次被布局藏掉了，由 CodingLayout 在 layout effect 里回报，只记不通知。
 */
let keepLeft = false
let fitLeftHidden = false

function setKeepLeft(value: boolean): void {
  if (keepLeft === value) return
  keepLeft = value
  listeners.forEach(fn => fn())
}
/** 同时改偏好和 keepLeft，只通知一次 */
function setLeft(next: CodingLayoutPrefs, keep: boolean): void {
  const keepChanged = keepLeft !== keep
  keepLeft = keep
  const stateChanged = next !== state
  set(next)
  if (keepChanged && !stateChanged) listeners.forEach(fn => fn())
}

export function getKeepLeft(): boolean {
  return keepLeft
}
export function useKeepLeft(): boolean {
  return useSyncExternalStore(subscribe, getKeepLeft, getKeepLeft)
}
/** CodingLayout 每次算完布局回报一次；只记不通知（不会触发重渲染） */
export function reportCodingFit(fit: Pick<CodingFit, 'leftHiddenByFit'>): void {
  fitLeftHidden = fit.leftHiddenByFit
}

const leftHiddenNow = (): boolean => state.left.open && fitLeftHidden

export const codingLayout = {
  toggle(panel: CodingPanel): void {
    if (panel === 'left') {
      if (leftHiddenNow()) setKeepLeft(true)
      else codingLayout.setOpen('left', !state.left.open)
      return
    }
    codingLayout.setOpen(panel, !state[panel].open)
  },
  setOpen(panel: CodingPanel, open: boolean): void {
    if (panel === 'left') {
      if (open && leftHiddenNow()) return setKeepLeft(true)
      if (state.left.open === open) return
      return setLeft({ ...state, left: { ...state.left, open } }, open)
    }
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
    setLeft({ ...state, left: { ...state.left, open: true, view } }, true)
  },
  toggleLeft(view: LeftView): void {
    // 左栏被布局藏掉时，点当前视图是「我要看」而不是「收起」
    if (leftHiddenNow() && state.left.view === view) return setKeepLeft(true)
    const next = toggleLeftView(state, view)
    setLeft(next, next.left.open)
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
