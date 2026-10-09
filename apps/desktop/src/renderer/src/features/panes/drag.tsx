import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/ui'
import { dropProblem, edgeAt, type Box, type DropTarget } from './drop'
import { getPaneState, paneActions } from './store'
import { findLeaf, leafOfTab } from './tree'

type BeginDrag = (event: ReactPointerEvent<HTMLElement>, tab: string, title: string) => void
export const PaneDragContext = createContext<BeginDrag>(() => {})
export const useBeginTabDrag = (): BeginDrag => useContext(PaneDragContext)

interface Hit {
  target: DropTarget
  box: Box
  marker: Box | null
  strip: HTMLElement | null
}
interface Preview extends Hit {
  problem: string | null
}
interface Visual {
  tab: string
  title: string
  x: number
  y: number
  preview: Preview | null
}
interface Gesture {
  tab: string
  title: string
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  started: boolean
  handle: HTMLElement
}
const EDGE_LABEL = {
  get left() {
    return tr('panes.drag.splitToLeft')
  },
  get right() {
    return tr('panes.drag.splitToRight')
  },
  get top() {
    return tr('panes.drag.splitAbove')
  },
  get bottom() {
    return tr('panes.drag.splitBelow')
  },
}

function boxOf(el: HTMLElement): Box {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}

function hitAt(area: HTMLElement, x: number, y: number): Hit | null {
  const hit = document.elementFromPoint(x, y)
  const pane = hit?.closest<HTMLElement>('[data-pane-id]')
  if (!pane || !area.contains(pane) || pane.closest('[inert]')) return null
  const leafId = pane.dataset.paneId!
  const leaf = findLeaf(getPaneState().layout.root, leafId)
  if (!leaf) return null
  const box = boxOf(pane)
  const strip = pane.querySelector<HTMLElement>('[data-tab-strip]')
  if (strip) {
    const r = strip.getBoundingClientRect()
    if (y >= r.top && y <= r.bottom) {
      const tabs = [...strip.querySelectorAll<HTMLElement>('[data-tab-id]')]
      const found = tabs.findIndex(tab => x < tab.getBoundingClientRect().left + tab.offsetWidth / 2)
      const index = found < 0 ? tabs.length : found
      const before = tabs[index]?.getBoundingClientRect()
      const last = tabs.at(-1)?.getBoundingClientRect()
      const at = Math.max(
        r.left + 2,
        Math.min(r.right - 2, before ? before.left - 2 : last ? last.right + 2 : r.left + 8),
      )
      return { target: { leafId, index }, box, marker: { x: at, y: r.top + 2, width: 2, height: r.height - 6 }, strip }
    }
  }
  const content = pane.querySelector<HTMLElement>('[data-pane-content]') ?? pane
  const edge = edgeAt(boxOf(content), x, y)
  return { target: edge ? { leafId, edge } : { leafId, index: leaf.tabs.length }, box, marker: null, strip: null }
}

/** 指针拖动只更新预览；松手一次性修改布局，Esc、失焦和取消都不移动标签。 */
export function usePaneDrag(area: RefObject<HTMLDivElement | null>) {
  const gesture = useRef<Gesture | null>(null)
  const skipClickUntil = useRef(0)
  const [visual, setVisual] = useState<Visual | null>(null)

  const begin = useCallback<BeginDrag>((event, tab, title) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      (event.target as HTMLElement).closest('button') ||
      document.querySelector('[role="dialog"][aria-modal="true"]')
    )
      return
    gesture.current = {
      tab,
      title,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      started: false,
      handle: event.currentTarget,
    }
  }, [])

  useEffect(() => {
    let frame = 0
    const finish = (): void => {
      const g = gesture.current
      if (g?.started) skipClickUntil.current = Date.now() + 250
      gesture.current = null
      cancelAnimationFrame(frame)
      frame = 0
      delete area.current?.dataset.tabDragging
      if (g?.handle.hasPointerCapture(g.pointerId)) g.handle.releasePointerCapture(g.pointerId)
      setVisual(null)
    }
    const preview = (): void => {
      const el = area.current
      const g = gesture.current
      if (!el || !g?.started) return
      const state = getPaneState()
      const owner = leafOfTab(state.layout.root, g.tab)
      if (!owner || state.closing[owner.id]) {
        finish()
        return
      }
      let hit = hitAt(el, g.x, g.y)
      if (hit && state.closing[hit.target.leafId]) hit = null
      // 连续帧滚动标签栏，指针不用移动也能拖到隐藏的标签。
      if (hit?.strip) {
        const r = hit.strip.getBoundingClientRect()
        const distance = g.x < r.left + 32 ? g.x - (r.left + 32) : g.x > r.right - 32 ? g.x - (r.right - 32) : 0
        if (distance) {
          hit.strip.scrollLeft += Math.max(-12, Math.min(12, distance / 3))
          hit = hitAt(el, g.x, g.y)
        }
      }
      const problem = hit
        ? dropProblem(state.layout, g.tab, hit.target, { width: el.clientWidth, height: el.clientHeight })
        : null
      setVisual({ tab: g.tab, title: g.title, x: g.x, y: g.y, preview: hit ? { ...hit, problem } : null })
      frame = requestAnimationFrame(preview)
    }
    const move = (event: PointerEvent): void => {
      const g = gesture.current
      if (!g || event.pointerId !== g.pointerId) return
      g.x = event.clientX
      g.y = event.clientY
      if (!g.started && Math.hypot(g.x - g.startX, g.y - g.startY) >= 6) {
        g.started = true
        g.handle.setPointerCapture(g.pointerId)
        if (area.current) area.current.dataset.tabDragging = 'true'
        frame = requestAnimationFrame(preview)
      }
      if (g.started) event.preventDefault()
    }
    const up = (event: PointerEvent): void => {
      const g = gesture.current
      if (!g || event.pointerId !== g.pointerId) return
      const el = area.current
      const hit = g.started && el ? hitAt(el, event.clientX, event.clientY) : null
      finish()
      if (hit && el) paneActions.dropTab(g.tab, hit.target, { width: el.clientWidth, height: el.clientHeight })
    }
    const cancel = (event: PointerEvent): void => {
      if (event.pointerId === gesture.current?.pointerId) finish()
    }
    const key = (event: KeyboardEvent): void => {
      if (!gesture.current?.started) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        finish()
      }
      // 避免快捷键在手持标签时关闭或改变布局。
      else if (event.ctrlKey || event.metaKey || event.altKey) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    const click = (event: MouseEvent): void => {
      if (Date.now() > skipClickUntil.current) return
      skipClickUntil.current = 0
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', finish)
    window.addEventListener('keydown', key, true)
    window.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', finish)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('click', click, true)
      finish()
    }
  }, [area])

  return { begin, visual }
}

export function DragPreview({ visual, area }: { visual: Visual | null; area: RefObject<HTMLDivElement | null> }) {
  useI18n()
  if (!visual || !area.current) return null
  const origin = area.current.getBoundingClientRect()
  const preview = visual.preview
  const box = preview ? { ...preview.box } : null
  if (box && preview?.target.edge) {
    const edge = preview.target.edge
    if (edge === 'left' || edge === 'right') {
      box.width /= 2
      if (edge === 'right') box.x += box.width
    } else {
      box.height /= 2
      if (edge === 'bottom') box.y += box.height
    }
  }
  const label =
    preview?.problem ??
    (preview?.marker
      ? tr('panes.drag.moveHere')
      : preview?.target.edge
        ? EDGE_LABEL[preview.target.edge]
        : preview
          ? tr('panes.drag.moveIntoThisPane')
          : tr('panes.drag.dragToTabBar'))
  return (
    <>
      {box && (
        <div
          data-drop-preview
          data-drop-edge={preview?.target.edge ?? 'merge'}
          className={cn(
            'pointer-events-none absolute z-30 flex items-center justify-center rounded-lg border-2',
            preview?.problem ? 'border-danger bg-danger/10' : 'border-accent bg-accent-soft/60',
          )}
          style={{
            left: box.x - origin.left + 4,
            top: box.y - origin.top + 4,
            width: Math.max(0, box.width - 8),
            height: Math.max(0, box.height - 8),
          }}
        >
          {!preview?.marker && (
            <span className="mx-4 rounded-md bg-popover px-3 py-2 text-center text-ui text-fg shadow-menu">
              {label}
            </span>
          )}
        </div>
      )}
      {preview?.marker && (
        <div
          data-drop-marker
          className="pointer-events-none absolute z-40 rounded-full bg-accent"
          style={{
            left: preview.marker.x - origin.left,
            top: preview.marker.y - origin.top,
            width: preview.marker.width,
            height: preview.marker.height,
          }}
        />
      )}
      {createPortal(
        <div
          data-drag-ghost
          className="pointer-events-none fixed z-50 max-w-64 rounded-lg border border-line-card bg-popover px-3 py-2 text-meta text-fg shadow-menu"
          style={{
            left: Math.min(Math.max(8, visual.x + 14), window.innerWidth - 264),
            top: Math.min(visual.y + 14, window.innerHeight - 66),
          }}
        >
          <div className="truncate font-medium">{visual.title}</div>
          <div className="mt-1 text-label text-fg-muted">{label}</div>
        </div>,
        document.body,
      )}
    </>
  )
}
