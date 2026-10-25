// 内置浏览器的批注栏放在哪、多大、收没收起（docs/ui/element-annotation.md §7）。全局记住，所有网页共用
import { useSyncExternalStore } from 'react'

export type AnnotationDock = 'top' | 'bottom' | 'left' | 'right'
export interface AnnotationDockPrefs {
  dock: AnnotationDock
  /** 放在左右时的宽度 */
  side: number
  /** 放在上下时的高度 */
  band: number
  folded: boolean
}

export const DOCKS: AnnotationDock[] = ['top', 'bottom', 'left', 'right']
export const SIDE_RANGE = { min: 200, max: 420 }
export const BAND_RANGE = { min: 140, max: 360 }
export const DEFAULT_DOCK_PREFS: AnnotationDockPrefs = { dock: 'right', side: 260, band: 188, folded: false }

const KEY = 'pixelsky.annotation-dock.v1'

const size = (v: unknown, range: { min: number; max: number }, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(range.max, Math.max(range.min, Math.round(v))) : fallback

/** 读存下的值；坏的、缺的字段用默认值，大小夹到范围里 */
export function parseDockPrefs(raw: string | null): AnnotationDockPrefs {
  try {
    const v = JSON.parse(raw ?? '{}') as Partial<Record<keyof AnnotationDockPrefs, unknown>>
    return {
      dock: DOCKS.includes(v.dock as AnnotationDock) ? (v.dock as AnnotationDock) : DEFAULT_DOCK_PREFS.dock,
      side: size(v.side, SIDE_RANGE, DEFAULT_DOCK_PREFS.side),
      band: size(v.band, BAND_RANGE, DEFAULT_DOCK_PREFS.band),
      folded: typeof v.folded === 'boolean' ? v.folded : DEFAULT_DOCK_PREFS.folded,
    }
  } catch {
    return DEFAULT_DOCK_PREFS
  }
}

/** 选了左右、面板又放不下（窄布局）时暂时放下面；选择本身不变 */
export function placedDock(dock: AnnotationDock, wide: boolean): AnnotationDock {
  return !wide && (dock === 'left' || dock === 'right') ? 'bottom' : dock
}

let prefs: AnnotationDockPrefs | null = null
const listeners = new Set<() => void>()

function current(): AnnotationDockPrefs {
  if (!prefs) {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(KEY)
    } catch {
      // 存储不可用：用默认值
    }
    prefs = parseDockPrefs(raw)
  }
  return prefs
}

/** save=false：拖动途中只改界面，松手再存 */
export function setDockPrefs(patch: Partial<AnnotationDockPrefs>, save = true): void {
  prefs = { ...current(), ...patch }
  if (save)
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      // 存不下只影响下次启动
    }
  listeners.forEach(l => l())
}

export function useDockPrefs(): AnnotationDockPrefs {
  return useSyncExternalStore(l => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, current)
}
