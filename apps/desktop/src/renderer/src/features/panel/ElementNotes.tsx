import { MessageSquareText, Trash2 } from 'lucide-react'
import { Button, IconButton } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import type { BrowserAnnotation, BrowserPage } from '../../../../shared/types/project-browser'
import { noteTitle, notesRoute } from './annotationText'
import { FIELD } from './ToolsUi'

function NoteItem({
  a,
  n,
  disabled,
  onRemove,
}: {
  a: BrowserAnnotation
  n: number
  disabled: boolean
  onRemove: (id: string) => void
}) {
  useI18n()
  return (
    <div data-annotation-item className="flex items-start gap-2 text-meta text-fg-secondary">
      {a.selector && (
        <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-label font-semibold text-accent-on">
          {n}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="break-words whitespace-pre-wrap" title={a.url}>
          {a.text}
        </p>
        {a.selector && (
          <p className="truncate font-mono text-label text-fg-faint" title={a.selector}>
            {noteTitle(a)}
          </p>
        )}
        {a.missing && <p className="text-label text-warn">{tr('projectTools.elementGone')}</p>}
      </div>
      {a.shot && (
        <img
          src={a.shot}
          alt={tr('projectTools.annotationShot')}
          draggable={false}
          className="h-8 w-12 shrink-0 rounded-sm border border-line-card object-cover"
        />
      )}
      <IconButton icon={Trash2} label={tr('projectTools.remove')} disabled={disabled} onClick={() => onRemove(a.id)} />
    </div>
  )
}

/**
 * 批注汇总（docs/ui/element-annotation.md §2）：面板宽时放在右侧（side），窄时是底部可折叠的样式。
 * 里面有整页批注的输入、刚发出去可以放回的提示、批注条目、「发给会话」和「清空」
 */
export function ElementNotes({
  page,
  side,
  busy,
  canSend,
  note,
  open,
  sent,
  onNote,
  onToggle,
  onAnnotate,
  onRemove,
  onClear,
  onSend,
  onRestore,
}: {
  page: BrowserPage
  side: boolean
  busy: boolean
  /** 能不能发给会话：有会话、不是演示 */
  canSend: boolean
  note: string
  /** 窄布局下列表是不是展开 */
  open: boolean
  sent: { pageId: string; notes: BrowserAnnotation[] } | null
  onNote: (value: string) => void
  onToggle: () => void
  onAnnotate: () => void
  onRemove: (id: string) => void
  onClear: () => void
  onSend: () => void
  onRestore: () => void
}) {
  useI18n()
  const body = (
    <>
      <form
        onSubmit={e => {
          e.preventDefault()
          onAnnotate()
        }}
        className="flex shrink-0 gap-2"
      >
        <input
          value={note}
          maxLength={4000}
          onChange={e => onNote(e.target.value)}
          placeholder={tr('projectTools.annotationPlaceholder')}
          className={FIELD}
        />
        <Button type="submit" disabled={busy || !note.trim()}>
          {tr('projectTools.save')}
        </Button>
      </form>
      {sent?.pageId === page.id && (
        <div className="flex shrink-0 items-center gap-2 rounded-md bg-accent-soft px-2.5 py-1.5 text-meta text-accent-fg">
          <span className="min-w-0 flex-1">{tr('projectTools.annotationSent', { p0: String(sent.notes.length) })}</span>
          <button disabled={busy} className="shrink-0 underline" onClick={onRestore}>
            {tr('projectTools.restoreAnnotation')}
          </button>
        </div>
      )}
      <div className={side ? 'flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto' : 'flex flex-col gap-2'}>
        {page.annotations.map((a, i) => (
          <NoteItem key={a.id} a={a} n={i + 1} disabled={busy} onRemove={onRemove} />
        ))}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          variant={side ? 'primary' : 'outline'}
          className={side ? 'flex-1 justify-center' : undefined}
          disabled={!canSend || !page.annotations.length || busy}
          title={!canSend ? tr('projectTools.noConversation') : undefined}
          onClick={onSend}
        >
          {tr('projectTools.sendAnnotation')}
        </Button>
        <Button disabled={!page.annotations.length || busy} onClick={onClear}>
          {tr('projectTools.clearAnnotations')}
        </Button>
      </div>
    </>
  )
  const route = notesRoute(page.annotations)
  if (side)
    return (
      <aside
        data-annotation-side
        className="flex w-60 shrink-0 flex-col gap-2 rounded-lg border border-line-card bg-surface p-2.5"
      >
        <h3 className="flex shrink-0 items-center gap-1.5 text-list font-semibold text-fg">
          <MessageSquareText size={15} />
          {tr('projectTools.annotation')} ({page.annotations.length})
          {route && <span className="ml-auto truncate font-mono text-label font-normal text-fg-muted">{route}</span>}
        </h3>
        {body}
      </aside>
    )
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <button onClick={onToggle} className="flex items-center gap-2 text-list text-fg-secondary">
        <MessageSquareText size={15} />
        {tr('projectTools.annotation')} ({page.annotations.length})
      </button>
      {open && <div className="flex max-h-52 flex-col gap-2 overflow-auto">{body}</div>}
    </div>
  )
}
