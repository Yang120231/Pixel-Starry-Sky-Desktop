import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { cn } from '@/ui'

/** 展开状态只存在内存里：切换左栏视图、重新挂载后保持 */
const openState = new Map<string, boolean>()

/** 可以折叠的小节标题（「AI 这一轮改的」「PIXELSKY」） */
export function Section({
  id,
  title,
  extra,
  defaultOpen = true,
  children,
}: {
  id: string
  title: ReactNode
  extra?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  useI18n()
  const [open, setOpen] = useState(() => openState.get(id) ?? defaultOpen)
  const toggle = (): void => {
    const next = !open
    openState.set(id, next)
    setOpen(next)
  }
  return (
    <section data-coding-section={id} className="flex min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 px-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={tr(open ? 'coding.shell.collapse' : 'coding.shell.expand')}
          onClick={toggle}
          className="press no-drag flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left text-label font-medium tracking-wide text-fg-muted uppercase hover:bg-hover hover:text-fg"
        >
          <ChevronRight
            size={14}
            strokeWidth={1.5}
            className={cn('shrink-0 transition-transform', open && 'rotate-90')}
          />
          <span className="min-w-0 truncate">{title}</span>
        </button>
        {extra ? <div className="no-drag flex shrink-0 items-center gap-0.5">{extra}</div> : null}
      </div>
      {open ? <div className="min-h-0">{children}</div> : null}
    </section>
  )
}
