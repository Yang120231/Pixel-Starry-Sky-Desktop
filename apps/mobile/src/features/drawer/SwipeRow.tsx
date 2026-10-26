// 抽屉会话行的左滑（只在触屏上、能操作时）：往左拖露出「置顶 / 归档」两个按钮（docs/ui/mobile-web-ios-mockup.html 的 .swipe）。
// 开没开由抽屉管（同时只开一行）；拖的过程自己记。touch-pan-y 让竖着滑还是列表滚动，横着滑才由这里接手。
import { useRef, useState, type ReactNode } from 'react'
import { Archive, Pin, PinOff } from 'lucide-react'
import { L } from '@/i18n'
import { cn } from '@/ui'
import { ACTIONS_W, dragOffset, lockAxis, settlesOpen } from './swipe'

export function SwipeRow({
  enabled,
  open,
  pinned,
  onOpen,
  onClose,
  onPin,
  onArchive,
  children,
}: {
  enabled: boolean
  open: boolean
  pinned: boolean
  onOpen(): void
  onClose(): void
  onPin(): void
  onArchive(): void
  children: ReactNode
}) {
  /** 手指拖着时行的偏移；没拖是 null */
  const [drag, setDrag] = useState<number | null>(null)
  const touch = useRef<{ x: number; y: number; axis: 'h' | 'v' | null } | null>(null)
  /** 刚横着拖过：松手后浏览器可能还补一个 click，别当成点开会话 */
  const dragged = useRef(false)
  if (!enabled) return children

  const offset = drag ?? (open ? -ACTIONS_W : 0)
  const end = () => {
    const t = touch.current
    touch.current = null
    if (t?.axis !== 'h' || drag === null) return
    ;(settlesOpen(drag) ? onOpen : onClose)()
    setDrag(null)
  }
  return (
    <div
      data-swipe-open={open ? '' : undefined}
      className="relative touch-pan-y overflow-hidden"
      onPointerDown={e => {
        if (e.pointerType !== 'touch') return
        touch.current = { x: e.clientX, y: e.clientY, axis: null }
        dragged.current = false
      }}
      onPointerMove={e => {
        const t = touch.current
        if (!t) return
        const dx = e.clientX - t.x
        t.axis ??= lockAxis(dx, e.clientY - t.y)
        if (t.axis !== 'h') return
        dragged.current = true
        setDrag(dragOffset(open ? -ACTIONS_W : 0, dx))
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {offset < 0 && (
        <div className="absolute inset-y-0 right-0 flex">
          <button
            type="button"
            onClick={onPin}
            className="flex w-[75px] flex-col items-center justify-center gap-1 bg-fg-muted text-label text-workbench"
          >
            {pinned ? <PinOff size={20} /> : <Pin size={20} />}
            {pinned ? L('取消置顶', 'Unpin') : L('置顶', 'Pin')}
          </button>
          <button
            type="button"
            onClick={onArchive}
            className="flex w-[75px] flex-col items-center justify-center gap-1 bg-warn text-label text-accent-on"
          >
            <Archive size={20} />
            {L('归档', 'Archive')}
          </button>
        </div>
      )}
      <div
        // 底色盖住后面的按钮；选中行的半透明底色画在 SessionRow 上，不会透出按钮
        className={cn('relative bg-workbench', drag === null && 'transition-transform duration-200')}
        style={{ transform: `translateX(${offset}px)` }}
        onClickCapture={e => {
          if (!dragged.current && !open) return
          e.stopPropagation()
          e.preventDefault()
          if (!dragged.current) onClose()
          dragged.current = false
        }}
      >
        {children}
      </div>
    </div>
  )
}
