// 输入框上方的两条细栏（docs/ui/rewind-fork-sidechat.md §1、§4）：撤销回退、代码评论交给 AI
import { useEffect, useState } from 'react'
import { MessageSquareCode, Undo2, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { IconButton, Spinner, cn } from '@/ui'

const BAR =
  'pop-in mb-2 flex min-h-9 items-center gap-2 rounded-lg border border-line-card bg-surface px-3 py-1 text-meta text-fg-secondary'
const ACTION = 'press rounded-md px-2 py-1 text-meta text-fg hover:bg-hover disabled:opacity-50'

export interface RewindDone {
  conversation: boolean
  files: number | null
}

export function RewindUndoBar({
  done,
  onUndo,
  onDismiss,
}: {
  done: RewindDone
  onUndo: () => Promise<void>
  onDismiss: () => void
}) {
  useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const text = !done.conversation
    ? tr('rewind.doneCode', { n: done.files ?? 0 })
    : done.files
      ? tr('rewind.doneFiles', { n: done.files })
      : tr('rewind.done')
  return (
    <div className={BAR} data-rewind-undo role="status">
      <Undo2 size={13} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1 truncate">{error ? <span className="text-danger">{error}</span> : text}</span>
      <button
        type="button"
        disabled={busy}
        className={ACTION}
        onClick={() => {
          setBusy(true)
          setError(null)
          onUndo()
            .catch((err: Error) => setError(translateMessage(err.message)))
            .finally(() => setBusy(false))
        }}
      >
        {busy ? <Spinner size={12} /> : tr('rewind.undo')}
      </button>
      <IconButton icon={X} label={tr('rewind.dismiss')} size={24} iconSize={12} onClick={onDismiss} />
    </div>
  )
}

export function ReviewCommentsBar({
  count,
  onHandoff,
  onClear,
}: {
  count: number
  /** 发出去：返回是直接开始还是排队 */
  onHandoff: () => Promise<'started' | 'queued'>
  onClear: () => void
}) {
  useI18n()
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!status || status.error) return
    const t = setTimeout(() => setStatus(null), 4000)
    return () => clearTimeout(t)
  }, [status])
  if (count === 0 && !status) return null
  return (
    <div className={BAR} data-review-comments>
      <MessageSquareCode size={13} strokeWidth={1.75} className="shrink-0 text-accent-fg" />
      <span className={cn('min-w-0 flex-1 truncate', status?.error && 'text-danger')}>
        {status ? status.text : count === 1 ? tr('review.countOne') : tr('review.count', { n: count })}
      </span>
      {count > 0 && (
        <>
          <button type="button" className={ACTION} onClick={onClear} disabled={busy}>
            {tr('review.clear')}
          </button>
          <button
            type="button"
            disabled={busy}
            className="press rounded-md bg-accent px-2.5 py-1 text-meta text-accent-on disabled:opacity-50"
            onClick={() => {
              setBusy(true)
              onHandoff()
                .then(how => setStatus({ text: tr(how === 'started' ? 'review.started' : 'review.queued') }))
                .catch((err: Error) =>
                  setStatus({ text: tr('review.failed', { reason: translateMessage(err.message) }), error: true }),
                )
                .finally(() => setBusy(false))
            }}
          >
            {tr('review.handoff')}
          </button>
        </>
      )}
    </div>
  )
}
