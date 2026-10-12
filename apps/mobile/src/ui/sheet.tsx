// 底部弹出的操作菜单（队列里一条消息能做的事、加图片选拍照还是相册）
import { useEffect, type ReactNode } from 'react'
import { cn } from './index'

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
