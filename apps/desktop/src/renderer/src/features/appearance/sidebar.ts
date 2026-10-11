import { useSyncExternalStore } from 'react'
import {
  DEFAULT_SIDEBAR_ICONS,
  LAYOUT_ACTIONS,
  SIDEBAR_ACTIONS,
  isSidebarIcon,
  type LayoutAction,
  type SidebarAction,
  type SidebarIconId,
  type SidebarIcons,
} from './sidebarIcons'

export type { HeaderAction, LayoutAction, SidebarAction, SidebarIconId, SidebarIcons } from './sidebarIcons'

/** header 是窗口右上角顶栏，top / bottom 是侧栏顶部和底部 */
export type SidebarPlacement = 'header' | 'top' | 'bottom'

export interface SidebarLayout {
  header: LayoutAction[]
  top: LayoutAction[]
  bottom: LayoutAction[]
}

export interface SidebarPrefs {
  version: 4
  showRecent: boolean
  recentExpanded: boolean
  icons: SidebarIcons
  layout: SidebarLayout
}

export const SIDEBAR_PREFS_KEY = 'pixelsky.sidebar'
export const DEFAULT_SIDEBAR_LAYOUT: SidebarLayout = {
  header: ['workbench', 'machines', 'channels', 'git', 'openIn'],
  top: ['addProject', 'newTask'],
  bottom: ['usage', 'plugins', 'settings'],
}
/** 侧栏最窄 240px 时一排放得下的可移动图标（顶部还有搜索、底部还有账号各占一格）；顶栏不限 */
export const SIDEBAR_ROW_LIMIT = 5

export const LAYOUT_PLACEMENTS: readonly SidebarPlacement[] = ['header', 'top', 'bottom']

/** 改名的入口：自动化换成了 Git（D061），保存的位置原样沿用 */
const RENAMED: Record<string, LayoutAction> = { automation: 'git' }

function isLayoutAction(value: unknown): value is LayoutAction {
  return LAYOUT_ACTIONS.includes(value as LayoutAction)
}

export function isRowFull(layout: SidebarLayout, row: SidebarPlacement, moving?: LayoutAction): boolean {
  return row !== 'header' && layout[row].filter(item => item !== moving).length >= SIDEBAR_ROW_LIMIT
}

/** 先保留三排已有的合法顺序，再把缺失入口补回默认排；侧栏排满时溢出到顶栏。 */
function parseSidebarLayout(value: unknown): SidebarLayout {
  const result: SidebarLayout = { header: [], top: [], bottom: [] }
  const seen = new Set<LayoutAction>()
  const place = (row: SidebarPlacement, action: LayoutAction): void => {
    result[isRowFull(result, row) ? 'header' : row].push(action)
    seen.add(action)
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const saved = value as Record<string, unknown>
    for (const row of LAYOUT_PLACEMENTS) {
      if (!Array.isArray(saved[row])) continue
      for (const raw of saved[row]) {
        const item = typeof raw === 'string' ? (RENAMED[raw] ?? raw) : raw
        if (isLayoutAction(item) && !seen.has(item)) place(row, item)
      }
    }
  }
  for (const row of LAYOUT_PLACEMENTS) {
    for (const action of DEFAULT_SIDEBAR_LAYOUT[row]) {
      if (!seen.has(action)) place(row, action)
    }
  }
  return result
}

function defaults(): SidebarPrefs {
  return {
    version: 4,
    showRecent: true,
    recentExpanded: true,
    icons: { ...DEFAULT_SIDEBAR_ICONS },
    layout: parseSidebarLayout(null),
  }
}

/** 旧版默认位置升级；v3 及以前没有顶栏排，按默认补齐。保留自定义布局、图标和历史偏好，损坏字段按项修复。 */
export function parseSidebarPrefs(value: unknown): SidebarPrefs {
  const result = defaults()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  const saved = value as Record<string, unknown>
  if (saved.version !== 1 && saved.version !== 2 && saved.version !== 3 && saved.version !== 4) return result
  if (typeof saved.showRecent === 'boolean') result.showRecent = saved.showRecent
  if (typeof saved.recentExpanded === 'boolean') result.recentExpanded = saved.recentExpanded
  if (saved.icons && typeof saved.icons === 'object' && !Array.isArray(saved.icons)) {
    const icons = saved.icons as Record<string, unknown>
    for (const action of SIDEBAR_ACTIONS) {
      if (isSidebarIcon(action, icons[action])) result.icons[action] = icons[action]
    }
  }
  if (saved.version === 2 || saved.version === 3 || saved.version === 4) {
    result.layout = parseSidebarLayout(saved.layout)
    if (
      saved.version === 2 &&
      result.layout.top.join() === 'addProject,newTask' &&
      result.layout.bottom.join() === 'settings,plugins,usage'
    ) {
      result.layout = parseSidebarLayout(null)
    }
  }
  return result
}

export function readSidebarPrefs(): SidebarPrefs {
  try {
    return parseSidebarPrefs(JSON.parse(localStorage.getItem(SIDEBAR_PREFS_KEY) ?? 'null'))
  } catch {
    return defaults()
  }
}

let prefs = readSidebarPrefs()
const listeners = new Set<() => void>()

export function getSidebarPrefs(): SidebarPrefs {
  return prefs
}

export function setSidebarPrefs(patch: Partial<Omit<SidebarPrefs, 'version'>>): void {
  prefs = parseSidebarPrefs({ ...prefs, ...patch, version: 4 })
  try {
    localStorage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // 存储不可用时，本窗口仍可切换，且不影响其他外观偏好。
  }
  listeners.forEach(listener => listener())
}

export function setSidebarIcon(action: SidebarAction, id: SidebarIconId): void {
  setSidebarPrefs({ icons: { ...prefs.icons, [action]: id } })
}

export function resetSidebarIcons(): void {
  setSidebarPrefs({ icons: { ...DEFAULT_SIDEBAR_ICONS } })
}

export function setSidebarLayout(layout: SidebarLayout): void {
  setSidebarPrefs({ layout })
}

export function resetSidebarLayout(): void {
  setSidebarLayout(DEFAULT_SIDEBAR_LAYOUT)
}

/** index 是先移除原位置后，在目标排中的插入索引；目标侧栏排已满时不移动。不修改传入布局。 */
export function moveSidebarActionInLayout(
  layout: SidebarLayout,
  action: LayoutAction,
  row: SidebarPlacement,
  index: number,
): SidebarLayout {
  const result = parseSidebarLayout(layout)
  if (!isLayoutAction(action) || !LAYOUT_PLACEMENTS.includes(row) || isRowFull(result, row, action)) return result
  for (const placement of LAYOUT_PLACEMENTS) result[placement] = result[placement].filter(item => item !== action)
  const target = result[row]
  const insertion = Number.isNaN(index) ? 0 : Math.max(0, Math.min(target.length, Math.trunc(index)))
  target.splice(insertion, 0, action)
  return result
}

export function moveSidebarAction(action: LayoutAction, row: SidebarPlacement, index: number): void {
  setSidebarLayout(moveSidebarActionInLayout(prefs.layout, action, row, index))
}

function onStorage(event: StorageEvent): void {
  try {
    if (event.storageArea !== localStorage || (event.key !== SIDEBAR_PREFS_KEY && event.key !== null)) return
  } catch {
    return
  }
  prefs = readSidebarPrefs()
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

export function useSidebarPrefs(): SidebarPrefs {
  return useSyncExternalStore(subscribe, getSidebarPrefs, getSidebarPrefs)
}
