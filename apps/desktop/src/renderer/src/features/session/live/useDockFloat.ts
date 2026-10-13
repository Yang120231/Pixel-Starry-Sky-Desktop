// 抽屉面板的「停靠 / 浮动」交互：量容器、拖标题栏移动、拖边角缩放、键盘、读写本机存储。
// 位置计算在 traceWindow.ts（纯函数）；这里只管 React 和指针事件，不带追踪面板的名字，旁问面板可复用。
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  DEFAULT_DOCK_WIDTH,
  MIN_DOCK_WIDTH,
  clampDockWidth,
  clampFloat,
  fitsFloat,
  fromFractions,
  loadWindowPrefs,
  maxDockWidth,
  resizeRect,
  saveWindowPrefs,
  toFractions,
  type Rect,
  type ResizeDir,
  type Size,
  type WindowPrefs,
} from './traceWindow'

export type DragKind = 'move' | ResizeDir

const DRAG_THRESHOLD = 4
const KEY_STEP = 16

/** 拖动期间给根元素的标记值：沿用 ResizeHandle 的 x / y，其余有各自的光标（globals.css） */
const dragMark = (kind: DragKind): string =>
  kind === 'move'
    ? 'move'
    : kind === 'e' || kind === 'w'
      ? 'x'
      : kind === 'n' || kind === 's'
        ? 'y'
        : kind === 'nw' || kind === 'se'
          ? 'nwse'
          : 'nesw'

interface Drag {
  pointer: number
  kind: DragKind
  downX: number
  downY: number
  start: Rect
  moved: boolean
  last: Rect
}

export interface DockFloatOptions {
  /** 被量的容器（面板的父元素）里，面板可用区域顶部让开的高度（会话顶部栏） */
  topOffset: number
  headerHeight: number
  storageKey?: string
}

export function useDockFloat(
  ref: { current: HTMLElement | null },
  { topOffset, headerHeight, storageKey }: DockFloatOptions,
) {
  const [prefs, setPrefs] = useState<WindowPrefs>(() => loadWindowPrefs(storageKey))
  const [container, setContainer] = useState<Size | null>(null)
  const [liveRect, setLiveRect] = useState<Rect | null>(null)
  const [liveDock, setLiveDock] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  const containerRef = useRef<Size | null>(null)
  containerRef.current = container
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const measure = (): void => {
      const next = { w: parent.clientWidth, h: Math.max(0, parent.clientHeight - topOffset) }
      setContainer(prev => (prev && prev.w === next.w && prev.h === next.h ? prev : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [ref, topOffset])

  const canFloat = container ? fitsFloat(container) : false
  const floating = liveRect !== null || (prefs.mode === 'float' && canFloat)
  const rect: Rect | null =
    container && floating
      ? (liveRect ?? clampFloat(fromFractions(prefs.float, container), container, headerHeight))
      : null
  const dockWidth = clampDockWidth(liveDock ?? prefs.dockWidth, container?.w ?? Infinity)

  const commit = useCallback(
    (next: WindowPrefs): void => {
      setPrefs(next)
      saveWindowPrefs(next, storageKey)
    },
    [storageKey],
  )

  const stopMark = (): void => {
    delete document.documentElement.dataset.layoutResize
  }
  useEffect(() => stopMark, [])

  const currentRect = (): Rect | null => {
    const c = containerRef.current
    if (!c) return null
    const p = prefsRef.current
    if (p.mode === 'float' && fitsFloat(c)) return clampFloat(fromFractions(p.float, c), c, headerHeight)
    return null
  }

  /** 正在拖动时按 Esc：撤回这次拖动。返回有没有拦下 */
  const cancelDrag = useCallback((): boolean => {
    if (!drag.current) return false
    drag.current = null
    setLiveRect(null)
    stopMark()
    return true
  }, [])

  const finish = (cancel = false): void => {
    const d = drag.current
    if (!d) return
    drag.current = null
    stopMark()
    const c = containerRef.current
    if (d.moved && !cancel && c) {
      commit({ ...prefsRef.current, mode: 'float', float: toFractions(d.last, c) })
    }
    setLiveRect(null)
  }

  const down = (kind: DragKind) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !e.isPrimary) return
    const c = containerRef.current
    if (!c || !fitsFloat(c)) return
    if (kind === 'move' && (e.target as HTMLElement).closest('button, a, input, [data-no-drag]')) return
    const existing = currentRect()
    let start: Rect
    if (existing) start = existing
    else {
      // 停靠中：脱离后用记住的浮动大小，标题栏上被按住的位置保持不变
      const el = e.currentTarget.getBoundingClientRect()
      const parent = ref.current?.parentElement?.getBoundingClientRect()
      const size = clampFloat(fromFractions(prefsRef.current.float, c), c, headerHeight)
      const ratio = el.width > 0 ? (e.clientX - el.left) / el.width : 0.5
      const px = e.clientX - (parent?.left ?? 0)
      start = clampFloat(
        { ...size, x: px - ratio * size.w, y: el.top - (parent?.top ?? 0) - topOffset },
        c,
        headerHeight,
      )
    }
    e.preventDefault()
    e.stopPropagation()
    if (kind !== 'move') (e.currentTarget as HTMLElement).focus?.({ preventScroll: true })
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      pointer: e.pointerId,
      kind,
      downX: e.clientX,
      downY: e.clientY,
      start,
      moved: false,
      last: start,
    }
    document.documentElement.dataset.layoutResize = dragMark(kind)
  }

  const move = (e: PointerEvent<HTMLElement>): void => {
    const d = drag.current
    const c = containerRef.current
    if (!d || !c || d.pointer !== e.pointerId) return
    const dx = e.clientX - d.downX
    const dy = e.clientY - d.downY
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    d.moved = true
    // 脱离停靠时，起点就是脱离那一刻的位置（光标下的标题栏位置不变），之后跟手
    d.last =
      d.kind === 'move'
        ? clampFloat({ ...d.start, x: d.start.x + dx, y: d.start.y + dy }, c, headerHeight)
        : resizeRect(d.start, d.kind, dx, dy, c)
    setLiveRect(d.last)
  }

  const dragProps = (kind: DragKind) => ({
    onPointerDown: down(kind),
    onPointerMove: move,
    onPointerUp: () => finish(),
    onPointerCancel: () => finish(true),
    onLostPointerCapture: () => finish(),
  })

  const setMode = (mode: WindowPrefs['mode']): void => {
    if (mode === 'float' && !canFloat) return
    commit({ ...prefs, mode })
  }
  const toggle = (): void => setMode(prefs.mode === 'float' && canFloat ? 'dock' : 'float')

  /** 浮动时标题栏获得焦点：方向键移动 16px，Shift + 方向键改大小 */
  const headerKey = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.target !== e.currentTarget || !rect || !container) return
    if (e.ctrlKey || e.altKey || e.metaKey) return
    const dx = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0
    const dy = e.key === 'ArrowUp' ? -KEY_STEP : e.key === 'ArrowDown' ? KEY_STEP : 0
    if (!dx && !dy) return
    e.preventDefault()
    e.stopPropagation()
    const next = e.shiftKey
      ? resizeRect(rect, 'se', dx, dy, container)
      : clampFloat({ ...rect, x: rect.x + dx, y: rect.y + dy }, container, headerHeight)
    commit({ ...prefs, mode: 'float', float: toFractions(next, container) })
  }

  return {
    container,
    canFloat,
    floating,
    /** 浮动时容器内的矩形（不含 topOffset）；停靠时 null */
    rect,
    dockWidth,
    dockMin: container ? Math.min(MIN_DOCK_WIDTH, maxDockWidth(container.w)) : MIN_DOCK_WIDTH,
    dockMax: container ? maxDockWidth(container.w) : 9999,
    dockPreview: setLiveDock,
    dockCommit: (width: number): void => {
      setLiveDock(null)
      commit({ ...prefsRef.current, dockWidth: Math.round(width) })
    },
    dockReset: (): void => {
      setLiveDock(null)
      commit({ ...prefsRef.current, dockWidth: DEFAULT_DOCK_WIDTH })
    },
    dragProps,
    toggle,
    headerKey,
    cancelDrag,
  }
}
