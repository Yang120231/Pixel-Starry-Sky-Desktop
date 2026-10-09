import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from './cn'

export interface MenuAction { label: string; run(): void; disabled?: boolean; danger?: boolean }
/** Shared context menu, outside scroll containers, with keyboard navigation. */
export function ActionMenu({ x, y, label, actions, onClose }: { x: number; y: number; label: string; actions: MenuAction[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null), close = useRef(onClose)
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
    const dismiss = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close.current() }
    const hide = () => close.current()
    window.addEventListener('pointerdown', dismiss); window.addEventListener('resize', hide); window.addEventListener('blur', hide)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('resize', hide); window.removeEventListener('blur', hide) }
  }, [])
  return createPortal(<div ref={ref} role="menu" aria-label={label} className="pop-in no-drag fixed z-[70] max-h-[calc(100vh-16px)] min-w-48 max-w-[calc(100vw-16px)] overflow-auto rounded-lg border border-line-card bg-popover p-1 shadow-menu" style={{ left: x, top: y }} onKeyDown={e => {
    e.stopPropagation()
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose() }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }
  }}>{actions.map(action => <button type="button" role="menuitem" key={action.label} disabled={action.disabled} className={cn('flex min-h-8 w-full items-center rounded-md px-3 py-1.5 text-left text-ui hover:bg-hover disabled:opacity-40', action.danger ? 'text-danger' : 'text-fg')} onClick={() => { onClose(); action.run() }}>{action.label}</button>)}</div>, document.body)
}
