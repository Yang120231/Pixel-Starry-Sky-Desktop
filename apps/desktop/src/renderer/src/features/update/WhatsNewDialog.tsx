// 更新后的「更新内容」弹窗（GitHub #13，docs/release-update.md §8）：每个版本只弹一次；「不再提示」以后都不弹，关于页能再打开
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Markdown } from '@/ui/markdown/Markdown'
import { notesFor, startWhatsNew, useWhatsNew, whatsNewActions } from './whatsNew'

export function WhatsNewDialog() {
  useI18n()
  const { open } = useWhatsNew()
  useEffect(startWhatsNew, [])
  if (!open) return null
  return <Dialog version={open.version} previous={open.previous} />
}

function Dialog({ version, previous }: { version: string; previous: string | null }) {
  const ref = useRef<HTMLDivElement>(null),
    done = useRef<HTMLButtonElement>(null),
    titleId = useId()
  const notes = notesFor({ version, previous })
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    done.current?.focus({ preventScroll: true })
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        whatsNewActions.close()
      }
      if (event.key === 'Tab') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])]
        const first = items[0],
          last = items.at(-1)
        if (!first || !last) return
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('keydown', key, true)
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-scrim p-6"
      onMouseDown={event => {
        if (event.target === event.currentTarget) whatsNewActions.close()
      }}
    >
      <div
        ref={ref}
        data-whats-new={version}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="pop-in flex max-h-[min(640px,85vh)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line-card bg-popover text-fg shadow-popover outline-none"
      >
        <div className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="text-section font-semibold">
              {tr('whatsNew.title', { p0: version })}
            </h3>
            {previous && previous !== version && (
              <p className="mt-0.5 text-meta text-fg-muted">{tr('whatsNew.from', { p0: previous })}</p>
            )}
          </div>
          <button
            type="button"
            aria-label={tr('whatsNew.close')}
            title={tr('whatsNew.close')}
            onClick={() => whatsNewActions.close()}
            className="press no-drag -mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="selectable min-h-0 flex-1 overflow-y-auto border-y border-line-subtle px-5 py-3">
          {notes.map(n => (
            <section key={n.version} data-whats-new-version={n.version} className="mb-6 last:mb-0">
              {notes.length > 1 && (
                <h4 className="mb-2 border-b border-line-subtle pb-1.5 text-section font-semibold text-fg">
                  {n.version}
                </h4>
              )}
              <Markdown text={n.text} className="text-list" />
            </section>
          ))}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 py-3">
          <button
            type="button"
            onClick={() => void window.pixelsky?.app.open('releases')}
            className="press no-drag inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-meta text-fg-secondary hover:bg-hover hover:text-fg"
          >
            <ExternalLink size={13} strokeWidth={1.5} />
            {tr('whatsNew.fullLog')}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => whatsNewActions.close(true)}
            className="press rounded-md px-3 py-2 text-ui text-fg-secondary hover:bg-hover hover:text-fg"
          >
            {tr('whatsNew.mute')}
          </button>
          <button
            ref={done}
            type="button"
            onClick={() => whatsNewActions.close()}
            className="press rounded-md bg-primary px-3 py-2 text-ui font-medium text-primary-fg"
          >
            {tr('whatsNew.done')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
