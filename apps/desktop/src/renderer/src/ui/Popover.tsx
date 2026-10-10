import { useI18n } from '@/i18n/I18nProvider'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from './cn'

interface PopoverProps {
  open: boolean
  onClose: () => void
  /** 相对于定位父元素的位置类名，例如 "bottom-0 left-full ml-2"。父元素需要 relative */
  className?: string
  children: ReactNode
}

/** 简单弹出层：点外面或按 Esc 关闭 */
export function Popover({ open, onClose, className, children }: PopoverProps) {
  useI18n()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      ref={ref}
      className={cn(
        'pop-in no-drag absolute z-40 min-w-44 rounded-lg border border-line-card bg-popover p-1 shadow-menu',
        className,
      )}
    >
      {children}
    </div>
  )
}

interface PopoverItemProps {
  icon?: ReactNode
  selected?: boolean
  onClick?: () => void
  /** 右边的快捷方式提示，例如「@」 */
  hint?: ReactNode
  disabled?: boolean
  /** 鼠标提示（不可点时说明原因） */
  title?: string
  children: ReactNode
}

export function PopoverItem({ icon, selected, onClick, hint, disabled, title, children }: PopoverItemProps) {
  useI18n()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ui text-fg hover:bg-hover',
        selected && 'bg-selected hover:bg-selected',
        disabled && 'cursor-default opacity-50 hover:bg-transparent',
      )}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {hint && <span className="shrink-0 font-mono text-meta text-fg-faint">{hint}</span>}
    </button>
  )
}
