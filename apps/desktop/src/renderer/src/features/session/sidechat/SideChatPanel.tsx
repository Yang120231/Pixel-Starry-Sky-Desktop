// 旁聊面板（docs/ui/rewind-fork-sidechat.md §3）：对话区右侧，上面问答，下面输入框；不进主对话
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, MessagesSquare, Square, Trash2, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { CopyButton, IconButton, Spinner, cn } from '@/ui'
import { Markdown } from '@/ui/markdown/Markdown'
import { askSide, clearSide, stopSide, useSideChat, type SideAsk, type SideCancel } from './store'

export function SideChatPanel({
  sessionId,
  ask,
  cancel,
  disabledReason,
  initialQuestion,
  belowHeader,
  onClose,
}: {
  sessionId: string
  ask: SideAsk
  cancel: SideCancel
  /** 还不能问的原因（例如还没发过消息）；null 表示可以 */
  disabledReason: string | null
  /** 从输入框的 /btw 打开时直接问这一句 */
  initialQuestion?: { text: string; token: number } | null
  belowHeader: boolean
  onClose: () => void
}) {
  useI18n()
  const entries = useSideChat(sessionId)
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const pending = entries.some(e => e.pending)

  useEffect(() => {
    if (initialQuestion?.text && !disabledReason) void askSide(sessionId, initialQuestion.text, ask)
    input.current?.focus()
    // 只在打开 / 再次从 /btw 提问时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion?.token])

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [entries])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (!list.current?.closest('aside')?.contains(document.activeElement)) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = (): void => {
    if (!draft.trim() || pending || disabledReason) return
    void askSide(sessionId, draft, ask)
    setDraft('')
  }

  return (
    <aside
      data-side-chat
      className={cn(
        'pop-in absolute right-0 bottom-0 z-30 flex w-[min(420px,92%)] flex-col border-l border-line bg-surface shadow-popover',
        belowHeader ? 'top-12' : 'top-0',
      )}
      aria-label={tr('side.title')}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        <MessagesSquare size={16} strokeWidth={1.5} className="shrink-0 text-fg-secondary" />
        <span className="text-ui font-medium text-fg">{tr('side.title')}</span>
        <span className="flex-1" />
        <IconButton
          icon={Trash2}
          label={tr('side.clear')}
          disabled={entries.length === 0}
          onClick={() => clearSide(sessionId, cancel)}
        />
        <IconButton icon={X} label={tr('side.close')} onClick={onClose} />
      </header>
      <div ref={list} className="selectable flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <p className="text-meta text-fg-muted">{tr('side.hint')}</p>
        {entries.map(e => (
          <div key={e.id} data-side-entry className="flex flex-col gap-2">
            <div className="self-end rounded-xl bg-subtle px-3 py-2 text-list whitespace-pre-wrap text-fg">
              {e.question}
            </div>
            {e.pending ? (
              <div className="flex items-center gap-2 text-list text-fg-muted">
                <Spinner size={13} />
                {tr('side.answering')}
              </div>
            ) : e.error ? (
              <div role="alert" className="text-list text-danger">
                {e.error}
              </div>
            ) : (
              <div className="group/side flex flex-col gap-1">
                <Markdown text={e.answer ?? ''} />
                <span className="opacity-0 transition-opacity group-hover/side:opacity-100">
                  <CopyButton text={e.answer ?? ''} label={tr('side.copy')} iconOnly />
                </span>
              </div>
            )}
          </div>
        ))}
        {entries.length === 0 && <p className="text-meta text-fg-faint">{tr('side.empty')}</p>}
      </div>
      <div className="shrink-0 border-t border-line-subtle p-3">
        {disabledReason && <p className="mb-2 text-meta text-fg-muted">{disabledReason}</p>}
        <div className="flex items-end gap-2 rounded-xl border border-line bg-app px-3 py-2 focus-within:border-line-strong">
          <textarea
            ref={input}
            rows={1}
            value={draft}
            disabled={!!disabledReason}
            placeholder={tr('side.placeholder')}
            aria-label={tr('side.placeholder')}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            className="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-list text-fg outline-none placeholder:text-fg-faint"
          />
          {pending ? (
            <IconButton icon={Square} label={tr('side.stop')} size={28} onClick={() => stopSide(sessionId, cancel)} />
          ) : (
            <IconButton
              icon={ArrowUp}
              label={tr('side.send')}
              size={28}
              disabled={!draft.trim() || !!disabledReason}
              onClick={submit}
            />
          )}
        </div>
        <p className="mt-1.5 text-label text-fg-faint">{tr('side.note')}</p>
      </div>
    </aside>
  )
}
