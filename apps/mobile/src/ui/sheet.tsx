// 底部弹出的操作菜单（队列里一条消息能做的事、加图片选拍照还是相册）
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { WIDE, cn, useMedia } from './index'

export interface SheetAction {
  label: string
  /** 一行小字说明 */
  hint?: string
  danger?: boolean
  disabled?: boolean
  onSelect(): void
}

export function ActionSheet({ title, actions, onClose }: { title?: string; actions: SheetAction[]; onClose(): void }) {
  // 返回键 / Esc 先关菜单
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        role="menu"
        className="sheet-in flex flex-col gap-2 px-3 pb-[max(env(safe-area-inset-bottom),12px)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="overflow-hidden rounded-2xl bg-popover shadow-popover">
          {title && (
            <div className="border-b border-line-subtle px-4 py-3 text-center text-meta text-fg-muted">{title}</div>
          )}
          {actions.map((a, i) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              disabled={a.disabled}
              onClick={() => {
                onClose()
                a.onSelect()
              }}
              className={cn(
                'flex min-h-14 w-full flex-col items-center justify-center px-4 py-2 active:bg-hover disabled:opacity-40',
                i > 0 && 'border-t border-line-subtle',
              )}
            >
              <span className={cn('text-ui', a.danger ? 'text-danger' : 'text-fg')}>{a.label}</span>
              {a.hint && <span className="text-label text-fg-muted">{a.hint}</span>}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-14 rounded-2xl bg-popover text-ui font-medium text-fg shadow-popover active:bg-hover"
        >
          取消
        </button>
      </div>
    </div>
  )
}

/** 做之前确认一下（Git 提交、推送）：写清楚要做什么，确认 / 取消 */
export function ConfirmSheet({
  title,
  children,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string
  children: ReactNode
  confirm: string
  onConfirm(): void
  onClose(): void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="sheet-in flex w-full max-w-lg flex-col gap-2 px-3 pb-[max(env(safe-area-inset-bottom),12px)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex max-h-[70dvh] flex-col overflow-hidden rounded-2xl bg-popover shadow-popover">
          <div className="border-b border-line-subtle px-4 py-3 text-center text-ui font-medium">{title}</div>
          <div className="min-h-0 overflow-y-auto px-4 py-3 text-meta text-fg-secondary">{children}</div>
          <button
            type="button"
            onClick={() => {
              onClose()
              onConfirm()
            }}
            className="min-h-14 border-t border-line-subtle text-ui font-medium text-accent-fg active:bg-hover"
          >
            {confirm}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-14 rounded-2xl bg-popover text-ui font-medium text-fg shadow-popover active:bg-hover"
        >
          取消
        </button>
      </div>
    </div>
  )
}

/**
 * 通用面板：窄屏从底部弹出（最高 85dvh，内容区自己滚动），宽屏（WIDE）改成右侧 420px 的覆盖面板。
 * Esc、点遮罩、右上角关闭都会调 onClose；children 放内容，footer 固定在底部。
 */
export function Sheet({
  title,
  children,
  footer,
  onClose,
}: {
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  onClose(): void
}) {
  const wide = useMedia(WIDE)
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  // 打开时焦点进面板、关闭时还给打开它的元素；Tab 只在面板里转
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.focus()
    return () => opener?.focus()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab' || !dialog.current) return
      const items = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter(el => !el.hasAttribute('disabled'))
      const first = items[0]
      const lastEl = items.at(-1)
      const active = document.activeElement
      if (!first || !lastEl) return e.preventDefault()
      if (e.shiftKey && (active === first || active === dialog.current)) (e.preventDefault(), lastEl.focus())
      else if (!e.shiftKey && active === lastEl) (e.preventDefault(), first.focus())
      else if (!dialog.current.contains(active)) (e.preventDefault(), first.focus())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className={cn('fixed inset-0 z-40 flex bg-black/40', wide ? 'justify-end' : 'flex-col justify-end')}
      onClick={onClose}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'flex min-h-0 flex-col bg-popover shadow-popover outline-none',
          wide
            ? 'panel-in h-full w-[420px] max-w-full border-l border-line-subtle'
            : 'sheet-in max-h-[85dvh] w-full rounded-t-2xl pb-[env(safe-area-inset-bottom)]',
        )}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line-subtle py-1 pr-1 pl-4">
          <div id={titleId} className="min-w-0 flex-1 truncate text-ui font-medium">
            {title}
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-fg-secondary active:bg-hover"
          >
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <div className="shrink-0 border-t border-line-subtle">{footer}</div>}
      </div>
    </div>
  )
}
