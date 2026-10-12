// 会话标签栏的滚动（GitHub #16，docs/ui/multi-pane.md）：竖直滚轮横向滚、中键 / 空白处按住拖动平移、
// 当前标签自动滚进可视区、两头还有内容时淡出。标签本身左键拖动仍是排序 / 移到别的窗格（drag.tsx）。
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { motionEnabled, settledResizeObserver } from './motion'

/** deltaMode 为「行」时一行算多少像素 */
const LINE_PX = 16
/** 当前标签滚进来时两边留的距离：比淡出的宽度多一点，标签不会压在淡出里 */
export const REVEAL_MARGIN = 28
/** 按下后移动超过这么多才算拖动平移，不然还是点击 */
const PAN_THRESHOLD = 4

export interface WheelInput {
  deltaX: number
  deltaY: number
  deltaMode: number
  shiftKey: boolean
}

/**
 * 滚轮 → 标签栏横向滚多少像素；不该接管时返回 null：
 * 横向为主的手势（触控板左右滑、Shift + 滚轮）浏览器本来就会横向滚
 */
export function wheelDistance(e: WheelInput, pageWidth: number): number | null {
  if (e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || !e.deltaY) return null
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? pageWidth : 1
  return e.deltaY * unit
}

/** 鼠标滚轮一格就是几十上百像素，要缓动过去；触控板是连续的小步，直接跟手 */
export const isWheelNotch = (e: WheelInput): boolean => e.deltaMode !== 0 || Math.abs(e.deltaY) >= 40

export interface ScrollView {
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
}

const maxScroll = (v: ScrollView): number => Math.max(0, v.scrollWidth - v.clientWidth)
export const clampScroll = (v: ScrollView, x: number): number => Math.min(maxScroll(v), Math.max(0, x))

/**
 * 让标签（left / width 是相对滚动内容的位置，即 offsetLeft / offsetWidth）完整露出来要滚到哪；
 * 已经完整可见时返回 null。标签比可视区还宽时露出开头
 */
export function revealTarget(
  v: ScrollView,
  tab: { left: number; width: number },
  margin = REVEAL_MARGIN,
): number | null {
  const start = tab.left - margin,
    end = tab.left + tab.width + margin
  let target: number | null = null
  if (end - start > v.clientWidth || start < v.scrollLeft) target = start
  else if (end > v.scrollLeft + v.clientWidth) target = end - v.clientWidth
  if (target === null) return null
  target = clampScroll(v, target)
  return Math.abs(target - v.scrollLeft) < 1 ? null : target
}

/** 缓动的一帧：走剩下距离的 22%，差不到半像素时直接到位 */
export function easeStep(pos: number, to: number): number {
  const diff = to - pos
  return Math.abs(diff) < 0.5 ? to : pos + diff * 0.22
}

/** 两头还有没露出来的标签 */
export function overflowEdges(v: ScrollView): { left: boolean; right: boolean } {
  return { left: v.scrollLeft > 1, right: v.scrollLeft < maxScroll(v) - 1 }
}

/**
 * 接到标签栏上：ref 是横向滚动的那一层（[data-tab-strip]），active 是当前标签，tabs 变了也重新检查。
 * 淡出用 data-fade-left / data-fade-right，平移中加 data-panning（panes.css），都直接写在元素上，不触发重渲染
 */
export function useTabStripScroll(ref: RefObject<HTMLElement | null>, active: string | null, tabs: string[]): void {
  const target = useRef<number | null>(null)
  const frame = useRef(0)
  const suppressUntil = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const edges = (): void => {
      const { left, right } = overflowEdges(el)
      el.toggleAttribute('data-fade-left', left)
      el.toggleAttribute('data-fade-right', right)
    }
    const stop = (): void => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      target.current = null
    }
    // 缓动到 target：每帧走剩下距离的一部分，连续滚几格时目标一直往前加。
    // 位置自己记（小数）：scrollLeft 会被取整，只差一两像素时每帧不到 1px 的一步会被吞掉、永远到不了
    let pos = 0
    const step = (): void => {
      const to = target.current
      if (to === null) return
      pos = easeStep(pos, to)
      el.scrollLeft = pos
      if (pos === to) stop()
      else frame.current = requestAnimationFrame(step)
    }
    const animateTo = (x: number): void => {
      if (!motionEnabled()) {
        stop()
        el.scrollLeft = x
        return
      }
      if (!frame.current) pos = el.scrollLeft
      target.current = x
      if (!frame.current) frame.current = requestAnimationFrame(step)
    }
    animators.set(el, { animateTo, stop, pending: () => target.current })

    const wheel = (e: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth) return
      const distance = wheelDistance(e, el.clientWidth)
      if (distance === null) return
      e.preventDefault()
      if (isWheelNotch(e)) animateTo(clampScroll(el, (target.current ?? el.scrollLeft) + distance))
      else {
        stop()
        el.scrollLeft = clampScroll(el, el.scrollLeft + distance)
      }
    }

    // 平移：中键在哪都行（包括标签上），左键只在空白处（标签上左键是拖动排序）
    let pan: { id: number; x: number; scroll: number; moved: boolean } | null = null
    const down = (e: PointerEvent): void => {
      const onTab = (e.target as HTMLElement).closest('[data-tab-id], button')
      if (!(e.button === 1 || (e.button === 0 && !onTab)) || el.scrollWidth <= el.clientWidth) return
      pan = { id: e.pointerId, x: e.clientX, scroll: el.scrollLeft, moved: false }
    }
    const move = (e: PointerEvent): void => {
      if (!pan || e.pointerId !== pan.id) return
      const dx = e.clientX - pan.x
      if (!pan.moved) {
        if (Math.abs(dx) < PAN_THRESHOLD) return
        pan.moved = true
        stop()
        el.setPointerCapture(e.pointerId)
        el.setAttribute('data-panning', '')
      }
      e.preventDefault()
      el.scrollLeft = clampScroll(el, pan.scroll - dx)
    }
    const up = (e: PointerEvent): void => {
      if (!pan || e.pointerId !== pan.id) return
      // 拖过了：松手后的点击、中键点击（会关闭标签）、双击（会放大窗格）都不算
      if (pan.moved) suppressUntil.current = Date.now() + 300
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      el.removeAttribute('data-panning')
      pan = null
    }
    const swallow = (e: Event): void => {
      if (Date.now() > suppressUntil.current) return
      e.preventDefault()
      e.stopPropagation()
    }
    // 中键按下默认会进入浏览器的自动滚动（圆形箭头），这里不要
    const mouseDown = (e: MouseEvent): void => {
      if (e.button === 1) e.preventDefault()
    }

    const resize = settledResizeObserver(() => {
      edges()
      reveal(el, false)
    })
    resize.observe(el)
    el.addEventListener('scroll', edges, { passive: true })
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('mousedown', mouseDown)
    for (const type of ['click', 'auxclick', 'dblclick']) el.addEventListener(type, swallow, true)
    edges()
    return () => {
      stop()
      animators.delete(el)
      resize.disconnect()
      el.removeEventListener('scroll', edges)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('mousedown', mouseDown)
      for (const type of ['click', 'auxclick', 'dblclick']) el.removeEventListener(type, swallow, true)
    }
  }, [ref])

  // 切换、新建、从别的窗格拖进来（当前标签变了或多了标签）：当前标签滚进可视区，第一次显示时直接到位。
  // 只是关掉别的标签时不动——正在翻标签栏、中键关掉一个，不该被拉回当前标签
  const seen = useRef<{ active: string | null; tabs: Set<string> } | null>(null)
  const tabsKey = tabs.join('\n')
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const before = seen.current
    seen.current = { active, tabs: new Set(tabs) }
    if (!before) reveal(el, false)
    else if (shouldReveal(before, active, tabs)) reveal(el, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tabs 用 tabsKey 比较内容
  }, [ref, active, tabsKey])
}

/** 当前标签换了，或者多了新标签（新建、拖进来）才滚；只少了标签不滚 */
export function shouldReveal(
  before: { active: string | null; tabs: Set<string> },
  active: string | null,
  tabs: string[],
): boolean {
  return before.active !== active || tabs.some(t => !before.tabs.has(t))
}

const animators = new WeakMap<
  HTMLElement,
  { animateTo: (x: number) => void; stop: () => void; pending: () => number | null }
>()

function reveal(el: HTMLElement, smooth: boolean): void {
  const tab = el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
  if (!tab) return
  const anim = animators.get(el)
  // 还在缓动时按缓动的终点判断：连按 Ctrl+Tab 时，上一次的滚动没走完，新标签在半路上看着可见、到了终点却被滚出去
  const pending = anim?.pending() ?? null
  const view = { scrollLeft: pending ?? el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }
  const to = revealTarget(view, { left: tab.offsetLeft, width: tab.offsetWidth })
  if (to === null) return
  if (smooth && anim) anim.animateTo(to)
  else {
    anim?.stop()
    el.scrollLeft = to
  }
}
