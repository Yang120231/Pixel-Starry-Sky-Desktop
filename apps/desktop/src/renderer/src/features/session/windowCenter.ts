import { useLayoutEffect, type RefObject } from 'react'

/**
 * 对话列按窗口居中（docs/ui/conversation-ux.md §2.8）：只有一个窗格、右侧面板收起、窗格贴着窗口右边时，
 * 返回「窗口中线 − 窗格中线」，CSS 再按各列自己的空余把它夹住（侧栏挡着时贴着侧栏）。其余情况返回 0，照旧在窗格里居中
 */
export function centerShift(
  view: { left: number; right: number },
  area: { left: number; right: number } | null,
  windowWidth: number,
): number {
  if (!area) return 0
  const fills = Math.abs(view.left - area.left) <= 1 && Math.abs(view.right - area.right) <= 1
  if (!fills || view.right < windowWidth - 1) return 0
  return Math.round(windowWidth / 2 - (view.left + view.right) / 2)
}

/** 在对话主区上写 --center-shift，侧栏开合（含动画）、窗口缩放、分屏时跟着更新 */
export function useWindowCenter(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (): void => {
      const area = el.closest('.pane-area')?.getBoundingClientRect() ?? null
      const shift = centerShift(el.getBoundingClientRect(), area, window.innerWidth)
      el.style.setProperty('--center-shift', `${shift}px`)
    }
    update()
    // 侧栏开合时窗格区域和窗格框不一定同一帧变：两个都看，下一帧再算一次，拿到稳定后的位置
    let frame = 0
    const schedule = (): void => {
      update()
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    const area = el.closest('.pane-area')
    if (area) observer.observe(area)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [ref])
}
