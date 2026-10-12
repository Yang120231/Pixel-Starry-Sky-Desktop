// 动画开关：跟随 设置 → 外观 → 动画（<html data-motion="on | system | off">，docs/ui/settings.md §3.1）

/** 现在要不要做动画 */
export function motionEnabled(): boolean {
  const mode = document.documentElement.dataset.motion ?? 'on'
  if (mode === 'off') return false
  if (mode === 'system') return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return true
}

/** 读设计变量里的时长（如 --dur-expand: 240ms）；读不到用默认值 */
export function cssDuration(name: '--dur-expand' | '--dur-collapse', fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return fallback
  return raw.endsWith('ms') ? n : raw.endsWith('s') ? n * 1000 : n
}

export const EASE_OUT = 'cubic-bezier(0.21, 0.47, 0.32, 0.98)'

/**
 * FLIP 动画：元素从旧位置平滑移到新位置（只用 translate，内容不变形）。
 * 在新位置已经渲染好之后调用，dx / dy 是旧位置减新位置。
 */
export function flipFrom(el: HTMLElement, dx: number, dy: number, duration = 200): void {
  if (!motionEnabled() || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)) return
  el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
    duration,
    easing: EASE_OUT,
  })
}

/**
 * 窗格拆分 / 关闭 / 均分 / 放大的过渡期间，Workspace 在 .pane-area 上标 data-pane-moving，
 * 过渡结束时去掉并在窗格区上发这个事件（冒泡到 document）。
 * 这期间窗格尺寸每帧都在变：量尺寸再 setState 的地方先不量，等结束后补一次，不然每帧都要重渲染（docs/ui/multi-pane.md §7）
 */
export const PANE_SETTLED = 'pixelsky:pane-settled'

/** 这个元素所在的窗格区正在过渡 */
export function paneMoving(el: Element | null | undefined): boolean {
  return !!el?.closest('.pane-area[data-pane-moving]')
}

/** 过渡结束时回调一次（不在窗格区里的元素永远等不到，只在 paneMoving 为真时挂起才用） */
export function onPaneSettled(fn: () => void): () => void {
  document.addEventListener(PANE_SETTLED, fn)
  return () => document.removeEventListener(PANE_SETTLED, fn)
}

/**
 * 和 ResizeObserver 一样用，但窗格过渡期间不回调，过渡结束后补一次。
 * 只给「量了尺寸存进 state」的地方用；需要每帧跟随的（对话贴底）仍用 ResizeObserver
 */
export function settledResizeObserver(fn: () => void): { observe: (el: Element) => void; disconnect: () => void } {
  let first: Element | null = null
  let pending = false
  const observer = new ResizeObserver(() => {
    if (paneMoving(first)) pending = true
    else fn()
  })
  const off = onPaneSettled(() => {
    if (!pending) return
    pending = false
    fn()
  })
  return {
    observe(el) {
      first ??= el
      observer.observe(el)
    },
    disconnect() {
      observer.disconnect()
      off()
    },
  }
}

/** 淡入（切换标签时内容区用） */
export function fadeIn(el: HTMLElement, duration = 140): void {
  if (!motionEnabled()) return
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-out' })
}
