import { Fragment, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check, type LucideIcon } from 'lucide-react'
import { cn } from './cn'

export interface MenuAction {
  label: string
  run(): void
  disabled?: boolean
  danger?: boolean
  /** 左侧图标 */
  icon?: LucideIcon
  /** 设置后成为可勾选项（menuitemcheckbox），为真时右侧打勾 */
  checked?: boolean
  /** 在这一项前面插入分组小标题 */
  section?: string
  /** 在这一项前面画一条分隔线（没有标题） */
  separator?: boolean
}
/** Shared context menu, outside scroll containers, with keyboard navigation. */
export function ActionMenu({
  x,
  y,
  label,
  actions,
  onClose,
}: {
  x: number
  y: number
  label: string
  actions: MenuAction[]
  onClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose)
  close.current = onClose
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`
    el.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [x, y])
  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current()
    }
    const hide = () => close.current()
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
    }
  }, [])
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="pop-in no-drag fixed z-[70] max-h-[calc(100vh-16px)] min-w-48 max-w-[calc(100vw-16px)] overflow-auto rounded-lg border border-line-card bg-popover p-1 shadow-menu"
      style={{ left: x, top: y }}
      onKeyDown={e => {
        e.stopPropagation()
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault()
          onClose()
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault()
          const next =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? items.length - 1
                : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          items[next]?.focus()
        }
      }}
    >
      {actions.map((action, index) => {
        const Icon = action.icon
        return (
          <Fragment key={`${index}:${action.label}`}>
            {action.section && (
              <div
                role="presentation"
                className={cn(
                  'px-3 pb-1 text-label text-fg-faint',
                  index > 0 ? 'mt-1 border-t border-line pt-2' : 'pt-1',
                )}
              >
                {action.section}
              </div>
            )}
            {action.separator && !action.section && index > 0 && (
              <div role="separator" className="mx-2 my-1 border-t border-line" />
            )}
            <button
              type="button"
              role={action.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={action.checked}
              disabled={action.disabled}
              className={cn(
                'flex min-h-8 w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-ui hover:bg-hover disabled:opacity-40',
                action.danger ? 'text-danger' : 'text-fg',
              )}
              onClick={() => {
                onClose()
                action.run()
              }}
            >
              {Icon && <Icon size={15} strokeWidth={1.5} className="shrink-0 text-fg-muted" />}
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
              {action.checked && <Check size={14} strokeWidth={1.75} className="shrink-0 text-fg-muted" />}
            </button>
          </Fragment>
        )
      })}
    </div>,
    document.body,
  )
}
