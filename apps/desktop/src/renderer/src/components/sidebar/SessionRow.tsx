import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Archive, ArchiveRestore, ArrowDownToLine, ArrowUpFromLine, Ellipsis, PencilLine, Trash2 } from 'lucide-react'
import { cn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { useSessionActions, type SessionTarget } from './SessionActions'
export function SessionRow({
  target,
  selected,
  onSelect,
  children,
  trailing,
  className,
}: {
  target: SessionTarget
  selected: boolean
  onSelect: (id: string) => void
  children: ReactNode
  trailing: ReactNode
  className?: string
}) {
  const { t } = useI18n(),
    actions = useSessionActions(),
    row = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null),
    [coords, setCoords] = useState<{ x: number; y: number } | null>(null)
  const close = (restore = true): void => {
    setPosition(null)
    setCoords(null)
    if (restore) button.current?.focus({ preventScroll: true })
  }
  const show = (x?: number, y?: number): void => {
    const rect = row.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({ x: x ?? rect.right - 180, y: y ?? rect.bottom + 4 })
  }
  useLayoutEffect(() => {
    if (!position || !menu.current) return
    const rect = menu.current.getBoundingClientRect()
    setCoords({
      x: Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8)),
    })
    const down = (e: PointerEvent): void => {
      if (!menu.current?.contains(e.target as Node) && !row.current?.contains(e.target as Node)) close(false)
    }
    const scroll = (e: Event): void => {
      if (!menu.current?.contains(e.target as Node)) close(false)
    }
    const resize = (): void => close(false)
    document.addEventListener('pointerdown', down)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
    }
  }, [position])
  useLayoutEffect(() => {
    if (coords) menu.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus({ preventScroll: true })
  }, [coords])
  return (
    <div
      ref={row}
      data-session-row={target.id}
      data-archived={target.archived || undefined}
      onContextMenu={event => {
        event.preventDefault()
        show(event.clientX, event.clientY)
      }}
      onKeyDown={event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault()
          show()
        }
      }}
      className={cn(
        'group/session relative flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-md pr-2.5 text-list transition-colors',
        selected ? 'bg-selected text-fg' : 'text-fg-secondary hover:bg-hover',
        target.archived && 'text-fg-muted',
        className,
      )}
    >
      <button
        ref={button}
        type="button"
        title={target.title}
        onClick={() => onSelect(target.id)}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-md pl-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        {children}
      </button>
      <div className="relative flex h-full min-w-6 shrink-0 items-center justify-end">
        <span
          className={cn(
            'flex items-center gap-1.5 group-hover/session:invisible group-focus-within/session:invisible',
            (selected || position) && 'invisible',
          )}
        >
          {trailing}
        </span>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={!!position}
          aria-label={t('session.actions', { title: target.title })}
          title={t('session.menu')}
          onClick={() => (position ? close() : show())}
          className={cn(
            'absolute right-0 flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-selected hover:text-fg focus-visible:ring-2 focus-visible:ring-accent',
            selected || position
              ? 'visible'
              : 'invisible group-hover/session:visible group-focus-within/session:visible',
          )}
        >
          <Ellipsis size={16} strokeWidth={1.5} />
        </button>
      </div>
      {position &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={t('session.menu')}
            data-session-menu
            className="pop-in no-drag fixed z-[70] min-w-44 rounded-lg border border-line-card bg-popover p-1 text-fg shadow-menu"
            style={{
              left: coords?.x ?? position.x,
              top: coords?.y ?? position.y,
              visibility: coords ? 'visible' : 'hidden',
            }}
            onKeyDown={event => {
              const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('[role=menuitem]')],
                i = items.indexOf(document.activeElement as HTMLButtonElement)
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                close()
              }
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                items[
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : (i + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
                ]?.focus({ preventScroll: true })
              }
              if (event.key === 'Tab') {
                event.preventDefault()
                close()
              }
            }}
          >
            <button
              role="menuitem"
              disabled={actions.busy}
              onClick={() => {
                close(false)
                actions.request('rename', target)
              }}
              className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-ui hover:bg-hover disabled:opacity-40"
            >
              <PencilLine size={15} strokeWidth={1.5} />
              {t('session.rename')}
            </button>
            <button
              role="menuitem"
              disabled={actions.busy}
              onClick={() => {
                close(false)
                actions.request('bottom', target)
              }}
              className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-ui hover:bg-hover disabled:opacity-40"
            >
              {target.bottomed ? (
                <ArrowUpFromLine size={15} strokeWidth={1.5} />
              ) : (
                <ArrowDownToLine size={15} strokeWidth={1.5} />
              )}{' '}
              {t(target.bottomed ? 'session.unbottom' : 'session.bottom')}
            </button>
            <div role="separator" className="my-1 border-t border-line-subtle" />
            <button
              role="menuitem"
              disabled={actions.busy}
              onClick={() => {
                close(false)
                actions.request(target.archived ? 'restore' : 'archive', target)
              }}
              className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-ui hover:bg-hover disabled:opacity-40"
            >
              {target.archived ? (
                <ArchiveRestore size={15} strokeWidth={1.5} />
              ) : (
                <Archive size={15} strokeWidth={1.5} />
              )}{' '}
              {t(target.archived ? 'session.restore' : 'session.archive')}
            </button>
            <button
              role="menuitem"
              disabled={actions.busy}
              onClick={() => {
                close(false)
                actions.request('delete', target)
              }}
              className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-ui text-danger hover:bg-hover disabled:opacity-40"
            >
              <Trash2 size={15} strokeWidth={1.5} />
              {t('session.deleteMenu')}
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
