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

/** 淡入（切换标签时内容区用） */
export function fadeIn(el: HTMLElement, duration = 140): void {
  if (!motionEnabled()) return
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-out' })
}
