// 抽屉面板的「停靠 / 浮动」摆法：读写和位置计算（docs/ui/agent-trace-window.md，GitHub #39）。
// 几何函数不带任何追踪面板的名字，旁问面板之后可以直接复用；只有存储的 key 和默认值是追踪窗口自己的。

export interface Size {
  w: number
  h: number
}

export interface Rect extends Size {
  x: number
  y: number
}

export type WindowMode = 'dock' | 'float'

/** 浮动窗口按「容器的比例」存，换窗口大小后仍在相近的位置 */
export interface WindowPrefs {
  version: 1
  mode: WindowMode
  /** 停靠宽度，px */
  dockWidth: number
  float: Rect
}

export const MIN_DOCK_WIDTH = 320
export const DEFAULT_DOCK_WIDTH = 560
export const MAX_DOCK_RATIO = 0.9
export const MIN_FLOAT: Size = { w: 320, h: 240 }
export const TRACE_WINDOW_KEY = 'pixelsky.agentTraceWindow'

export const DEFAULT_WINDOW_PREFS: WindowPrefs = {
  version: 1,
  mode: 'dock',
  dockWidth: DEFAULT_DOCK_WIDTH,
  float: { x: 0.5, y: 0.05, w: 0.46, h: 0.82 },
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** 停靠宽度的上限：容器宽度的 90%（容器比最小宽度还窄时，最小宽度也让位） */
export function maxDockWidth(containerW: number): number {
  return Math.max(0, Math.floor(containerW * MAX_DOCK_RATIO))
}

export function clampDockWidth(width: number, containerW: number): number {
  const hi = maxDockWidth(containerW)
  const lo = Math.min(MIN_DOCK_WIDTH, hi)
  return Math.round(clamp(Number.isFinite(width) ? width : DEFAULT_DOCK_WIDTH, lo, hi))
}

/** 容器放得下最小的浮动窗口吗；放不下就只能停靠 */
export function fitsFloat(container: Size, min: Size = MIN_FLOAT): boolean {
  return container.w >= min.w && container.h >= min.h
}

/**
 * 把矩形限制在容器里：先缩小（不小于最小尺寸；容器比最小尺寸还小则跟着容器），再挪回区域内。
 * 窗口整体在容器里，所以标题栏（headerHeight 高）一定完整可见；高度不会小于标题栏。
 */
export function clampFloat(rect: Rect, container: Size, headerHeight = 0, min: Size = MIN_FLOAT): Rect {
  const minW = Math.min(min.w, container.w)
  const minH = Math.min(Math.max(min.h, headerHeight), container.h)
  const w = Math.round(clamp(rect.w, minW, container.w))
  const h = Math.round(clamp(rect.h, minH, container.h))
  return {
    w,
    h,
    x: Math.round(clamp(rect.x, 0, container.w - w)),
    y: Math.round(clamp(rect.y, 0, container.h - h)),
  }
}

export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** 拖边或角：被拖的边跟着指针走，不越过容器、也不小于最小尺寸，对边不动 */
export function resizeRect(
  start: Rect,
  dir: ResizeDir,
  dx: number,
  dy: number,
  container: Size,
  min: Size = MIN_FLOAT,
): Rect {
  const minW = Math.min(min.w, container.w)
  const minH = Math.min(min.h, container.h)
  let left = start.x
  let right = start.x + start.w
  let top = start.y
  let bottom = start.y + start.h
  if (dir.includes('w')) left = clamp(left + dx, 0, right - minW)
  if (dir.includes('e')) right = clamp(right + dx, left + minW, container.w)
  if (dir.includes('n')) top = clamp(top + dy, 0, bottom - minH)
  if (dir.includes('s')) bottom = clamp(bottom + dy, top + minH, container.h)
  return { x: Math.round(left), y: Math.round(top), w: Math.round(right - left), h: Math.round(bottom - top) }
}

export function toFractions(rect: Rect, container: Size): Rect {
  if (container.w <= 0 || container.h <= 0) return { ...DEFAULT_WINDOW_PREFS.float }
  return { x: rect.x / container.w, y: rect.y / container.h, w: rect.w / container.w, h: rect.h / container.h }
}

export function fromFractions(f: Rect, container: Size): Rect {
  return {
    x: Math.round(f.x * container.w),
    y: Math.round(f.y * container.h),
    w: Math.round(f.w * container.w),
    h: Math.round(f.h * container.h),
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 读到坏数据（不是 JSON、版本不对、字段缺失或越界）就整个用默认值 */
export function parseWindowPrefs(raw: string | null): WindowPrefs {
  if (!raw) return structuredClone(DEFAULT_WINDOW_PREFS)
  try {
    const v = JSON.parse(raw) as Partial<WindowPrefs> | null
    const f = v?.float
    if (
      !v ||
      v.version !== 1 ||
      (v.mode !== 'dock' && v.mode !== 'float') ||
      !isNum(v.dockWidth) ||
      v.dockWidth < MIN_DOCK_WIDTH ||
      !f ||
      !isNum(f.x) ||
      !isNum(f.y) ||
      !isNum(f.w) ||
      !isNum(f.h) ||
      f.x < 0 ||
      f.y < 0 ||
      f.w <= 0 ||
      f.h <= 0 ||
      f.w > 1 ||
      f.h > 1
    )
      return structuredClone(DEFAULT_WINDOW_PREFS)
    return {
      version: 1,
      mode: v.mode,
      dockWidth: Math.round(v.dockWidth),
      float: { x: f.x, y: f.y, w: f.w, h: f.h },
    }
  } catch {
    return structuredClone(DEFAULT_WINDOW_PREFS)
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const defaultStorage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadWindowPrefs(
  key: string = TRACE_WINDOW_KEY,
  storage: StorageLike | null = defaultStorage(),
): WindowPrefs {
  try {
    return parseWindowPrefs(storage?.getItem(key) ?? null)
  } catch {
    return structuredClone(DEFAULT_WINDOW_PREFS)
  }
}

export function saveWindowPrefs(
  prefs: WindowPrefs,
  key: string = TRACE_WINDOW_KEY,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(key, JSON.stringify(prefs))
  } catch {
    // 存不下（隐私模式、配额）就只在本次有效
  }
}
