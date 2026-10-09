import { useI18n } from '@/i18n/I18nProvider'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { cn } from './cn'

interface CollapsibleSlotProps {
  open: boolean
  /** 展开时的宽度（px），里面的内容始终保持这个宽度 */
  width: number
  /** 贴在窗口哪一侧：左侧栏向左滑出，右侧面板向右滑出 */
  side: 'left' | 'right'
  children: ReactNode
}

/**
 * 可收起的侧栏容器（参考 Mirasim）：外层宽度在 width 和 0 之间做动画，里面的内容保持固定宽度、
 * 贴着窗口边缘被裁切，所以是整体滑出 / 滑入，不会被挤压换行。
 * 内容一直挂载（保留滚动位置等状态），收起时设为 inert。动画样式见 globals.css .collapsible-slot。
 */
export function CollapsibleSlot({ open, width, side, children }: CollapsibleSlotProps) {
  useI18n()
  const slot = useRef<HTMLDivElement>(null), previousWidth = useRef(width)
  useLayoutEffect(() => {
    if (previousWidth.current === width || !slot.current) return
    previousWidth.current = width
    slot.current.dataset.sizeChanged = ''
    let next = 0
    const frame = requestAnimationFrame(() => { next = requestAnimationFrame(() => { if (slot.current) delete slot.current.dataset.sizeChanged }) })
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(next) }
  }, [width])
  return (
    <div
      ref={slot}
      className={cn('collapsible-slot flex h-full shrink-0 overflow-hidden', side === 'right' && 'justify-end')}
      style={{ width: open ? width : 0 }}
      data-open={open || undefined}
      aria-hidden={!open || undefined}
      inert={!open}
    >
      <div className="flex h-full shrink-0" style={{ width }}>
        {children}
      </div>
    </div>
  )
}
