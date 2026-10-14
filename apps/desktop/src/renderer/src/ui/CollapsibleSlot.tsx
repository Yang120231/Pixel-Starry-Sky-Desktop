import { useI18n } from '@/i18n/I18nProvider'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { cn } from './cn'

interface CollapsibleSlotProps {
  open: boolean
  /** 展开时的宽度（px），里面的内容始终保持这个宽度（left / right 用） */
  width?: number
  /** 展开时的高度（px），里面的内容始终保持这个高度（bottom 用） */
  size?: number
  /** 贴在窗口哪一侧：左侧栏向左滑出，右侧面板向右滑出；bottom 是代码模式的底部面板，向下滑出 */
  side: 'left' | 'right' | 'bottom'
  /** 宽度一步到位、不做宽度动画，由外面用位移把内容滑进 / 滑出（对话模式侧边栏，app/SidebarFollow.tsx） */
  slide?: boolean
  children: ReactNode
}

/**
 * 可收起的侧栏容器（参考 Mirasim）：外层宽度在 width 和 0 之间做动画，里面的内容保持固定宽度、
 * 贴着窗口边缘被裁切，所以是整体滑出 / 滑入，不会被挤压换行。
 * 内容一直挂载（保留滚动位置等状态），收起时设为 inert。动画样式见 globals.css .collapsible-slot。
 */
export function CollapsibleSlot({ open, width: widthProp = 0, size = 0, side, slide, children }: CollapsibleSlotProps) {
  useI18n()
  const bottom = side === 'bottom',
    width = bottom ? size : widthProp
  const slot = useRef<HTMLDivElement>(null),
    previousWidth = useRef(width)
  useLayoutEffect(() => {
    if (previousWidth.current === width || !slot.current) return
    previousWidth.current = width
    slot.current.dataset.sizeChanged = ''
    let next = 0
    const frame = requestAnimationFrame(() => {
      next = requestAnimationFrame(() => {
        if (slot.current) delete slot.current.dataset.sizeChanged
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(next)
    }
  }, [width])
  return (
    <div
      ref={slot}
      className={cn(
        'collapsible-slot flex shrink-0 overflow-hidden',
        bottom ? 'w-full' : 'h-full',
        side === 'right' && 'justify-end',
      )}
      style={bottom ? { height: open ? width : 0 } : { width: open ? width : 0 }}
      data-side={bottom ? 'bottom' : undefined}
      data-slide={slide || undefined}
      data-open={open || undefined}
      aria-hidden={!open || undefined}
      inert={!open}
    >
      <div
        className={bottom ? 'flex w-full shrink-0' : 'flex h-full shrink-0'}
        style={bottom ? { height: width } : { width }}
      >
        {children}
      </div>
    </div>
  )
}
