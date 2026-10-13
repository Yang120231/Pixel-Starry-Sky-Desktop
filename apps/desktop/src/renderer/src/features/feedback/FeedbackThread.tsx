// 设置 › 反馈 › 一条反馈（docs/ui/feedback.md §2.2）：消息、附件、补充框、关闭
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, FileText, Paperclip } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { Button, Spinner, cn } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import type { FeedbackAttachmentMeta, FeedbackDetail, FeedbackMessage } from '../../../../shared/types/feedback'
import { AttachmentOptions, TextBox, type AttachmentValue } from './AttachmentOptions'
import { INPUT_CLASS, reasonText } from './FeedbackForm'
import { ImageField, toImageInputs, useFeedbackImages } from './ImageField'
import { checkReply, diagnosticsLines, errorText, isAuthExpired, sizeText, type LimitReason } from './logic'
import { Crumbs, StatusWord, TypeChip, formatTime } from './parts'
import { feedbackApi, useFeedback } from './store'
import { useFeedbackPreview } from './usePreview'

export function FeedbackThread({
  id,
  onBack,
  onFailed,
}: {
  id: string
  onBack: () => void
  /** 出错（登录过期时让页面刷新状态） */
  onFailed: (e: unknown) => void
}) {
  useI18n()
  const [detail, setDetail] = useState<FeedbackDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [confirmClose, setConfirmClose] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const { threads } = useFeedback()

  useEffect(() => {
    let cancelled = false
    setError(null)
    feedbackApi()
      .get(id)
      .then(
        next => {
          if (!cancelled) setDetail(next)
        },
        (e: unknown) => {
          if (cancelled) return
          setError(translateMessage(errorText(e)))
          if (isAuthExpired(e)) onFailed(e)
        },
      )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, nonce])

  // 轮询发现这条有新动静（团队在别处回复 / 关闭）：重新取一次
  const listed = threads.find(t => t.id === id)
  useEffect(() => {
    if (detail && listed && listed.updatedAt > detail.thread.updatedAt) setNonce(n => n + 1)
  }, [listed, detail])

  const close = async (): Promise<void> => {
    setClosing(true)
    setCloseError(null)
    try {
      setDetail(await feedbackApi().close(id))
      void feedbackApi()
        .refresh()
        .catch(() => {})
      setConfirmClose(false)
    } catch (e) {
      setCloseError(translateMessage(errorText(e)))
      if (isAuthExpired(e)) onFailed(e)
    } finally {
      setClosing(false)
    }
  }

  const thread = detail?.thread
  return (
    <div data-feedback-thread={id}>
      <Crumbs
        current={thread?.title ?? '…'}
        onBack={onBack}
        right={
          thread && (
            <div className="flex shrink-0 items-center gap-3">
              <TypeChip type={thread.type} />
              <StatusWord status={thread.status} />
              {thread.status !== 'closed' && (
                <Button onClick={() => setConfirmClose(true)}>{tr('feedback.thread.close')}</Button>
              )}
            </div>
          )
        }
      />
      {error && (
        <p className="selectable mb-4 flex items-center gap-2 rounded-md bg-subtle px-3 py-2 text-meta text-danger">
          <span className="min-w-0 flex-1 break-all">{error}</span>
          <button type="button" className="shrink-0 text-accent hover:underline" onClick={() => setNonce(n => n + 1)}>
            {tr('feedback.retry')}
          </button>
        </p>
      )}
      {!detail && !error && (
        <div className="flex items-center gap-2 py-8 text-meta text-fg-muted">
          <Spinner size={13} />
          {tr('feedback.loading')}
        </div>
      )}
      {detail && (
        <>
          <ol className="flex flex-col gap-3">
            {detail.messages.map(m => (
              <li key={m.id}>
                <Message threadId={id} message={m} />
              </li>
            ))}
          </ol>
          <ReplyBox threadId={id} closed={detail.thread.status === 'closed'} onSent={setDetail} onFailed={onFailed} />
        </>
      )}
      {confirmClose && (
        <ConfirmDialog
          title={tr('feedback.thread.closeTitle')}
          description={tr('feedback.thread.closeBody')}
          confirmLabel={tr('feedback.thread.close')}
          cancelLabel={tr('feedback.form.cancel')}
          busy={closing}
          error={closeError}
          onConfirm={() => void close()}
          onCancel={() => setConfirmClose(false)}
        />
      )}
    </div>
  )
}

function Message({ threadId, message }: { threadId: string; message: FeedbackMessage }) {
  useI18n()
  if (message.kind !== 'message') {
    const label =
      message.kind === 'closed'
        ? message.author === 'team'
          ? tr('feedback.thread.closedByTeam')
          : tr('feedback.thread.closedByUser')
        : message.author === 'team'
          ? tr('feedback.thread.reopenedByTeam')
          : tr('feedback.thread.reopenedByUser')
    return (
      <p className="text-center text-label text-fg-faint">
        ─ {label} · {formatTime(message.createdAt)} ─
      </p>
    )
  }
  const team = message.author === 'team'
  const hasAttachments = message.diagnostics || message.error || message.attachments.length > 0
  return (
    <div
      data-feedback-message={message.author}
      className={cn(
        'max-w-[85%] rounded-lg border px-3.5 py-2.5',
        team ? 'ml-auto border-transparent bg-accent-soft' : 'border-line bg-surface',
      )}
    >
      <div className="mb-1 text-label text-fg-muted">
        {team ? tr('feedback.team') : tr('feedback.you')} · {formatTime(message.createdAt)}
      </div>
      <p className="selectable text-ui break-words whitespace-pre-wrap text-fg">{message.body}</p>
      {hasAttachments && <Chips threadId={threadId} message={message} />}
    </div>
  )
}

type Open = 'diagnostics' | 'error' | number | null

/** 附件：诊断信息、出错片段点开显示文字；日志点开才去取；图片是缩略图 */
function Chips({ threadId, message }: { threadId: string; message: FeedbackMessage }) {
  const [open, setOpen] = useState<Open>(null)
  const toggle = (value: Exclude<Open, null>): void => setOpen(current => (current === value ? null : value))
  const images = message.attachments.filter(a => a.kind === 'image')
  const logs = message.attachments.filter(a => a.kind === 'log')
  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {message.diagnostics && (
          <ChipButton open={open === 'diagnostics'} onClick={() => toggle('diagnostics')}>
            {tr('feedback.attach.diagnostics')}
          </ChipButton>
        )}
        {logs.map(a => (
          <ChipButton key={a.id} open={open === a.id} disabled={!a.available} onClick={() => toggle(a.id)}>
            {a.available
              ? tr('feedback.thread.log', { p0: sizeText(a.rawSize) })
              : `${tr('feedback.thread.log', { p0: sizeText(a.rawSize) })} · ${tr('feedback.thread.expired')}`}
          </ChipButton>
        ))}
        {message.error && (
          <ChipButton open={open === 'error'} onClick={() => toggle('error')}>
            {tr('feedback.thread.errorSnippet')}
          </ChipButton>
        )}
        {images.map(a => (
          <ImageThumb key={a.id} threadId={threadId} meta={a} />
        ))}
      </div>
      {open === 'diagnostics' && message.diagnostics && (
        <TextBox text={diagnosticsLines(message.diagnostics)} label={tr('feedback.attach.diagnostics')} />
      )}
      {open === 'error' && message.error && (
        <TextBox
          text={`${message.error.text}\n\n${tr('feedback.attach.session', { p0: message.error.sessionId })} · ${formatTime(message.error.at)}`}
          label={tr('feedback.thread.errorSnippet')}
        />
      )}
      {typeof open === 'number' && <LogBox threadId={threadId} attachmentId={open} />}
    </div>
  )
}

function ChipButton({
  open,
  disabled,
  onClick,
  children,
}: {
  open: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      disabled={disabled}
      onClick={onClick}
      className="press inline-flex h-6 items-center gap-1 rounded-md border border-line bg-surface px-2 text-label text-fg-secondary hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-45"
    >
      <Paperclip size={12} strokeWidth={1.5} />
      {children}
      <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
    </button>
  )
}

/** 日志点开后才去取 */
function LogBox({ threadId, attachmentId }: { threadId: string; attachmentId: number }) {
  useI18n()
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setText(null)
    setError(null)
    feedbackApi()
      .attachment(threadId, attachmentId)
      .then(
        data => {
          if (!cancelled) setText(data.kind === 'log' ? data.text : '')
        },
        (e: unknown) => {
          if (!cancelled) setError(tr('feedback.thread.loadFailed', { p0: translateMessage(errorText(e)) }))
        },
      )
    return () => {
      cancelled = true
    }
  }, [threadId, attachmentId])
  if (error) return <p className="selectable mt-2 text-meta text-danger">{error}</p>
  if (text === null)
    return (
      <p className="mt-2 flex items-center gap-1.5 text-meta text-fg-muted">
        <Spinner size={12} />
        {tr('feedback.loading')}
      </p>
    )
  return <TextBox text={text} label={tr('feedback.thread.log', { p0: '' })} />
}

/** 图片缩略图：进入页面就取（很小），点开看大图 */
function ImageThumb({ threadId, meta }: { threadId: string; meta: FeedbackAttachmentMeta }) {
  useI18n()
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [big, setBig] = useState(false)
  useEffect(() => {
    if (!meta.available) return
    let cancelled = false
    feedbackApi()
      .attachment(threadId, meta.id)
      .then(
        data => {
          if (cancelled) return
          if (data.kind === 'image') setUrl(`data:${data.mediaType};base64,${data.data}`)
        },
        () => {
          if (!cancelled) setFailed(true)
        },
      )
    return () => {
      cancelled = true
    }
  }, [threadId, meta.id, meta.available])
  const unavailable = !meta.available || failed
  return (
    <>
      <button
        type="button"
        disabled={!url}
        title={meta.name}
        aria-label={`${tr('feedback.thread.image')} ${meta.name}`}
        onClick={() => setBig(true)}
        className="press flex size-12 items-center justify-center overflow-hidden rounded-md border border-line-card bg-subtle text-fg-faint"
      >
        {url ? (
          <img src={url} alt={meta.name} className="size-full object-cover" />
        ) : unavailable ? (
          <FileText size={16} />
        ) : (
          <Spinner size={12} />
        )}
      </button>
      {big && url && <Lightbox url={url} name={meta.name} onClose={() => setBig(false)} />}
    </>
  )
}

function Lightbox({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  return createPortal(
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onClick={onClose}
      className="fade-in fixed inset-0 z-[70] flex items-center justify-center bg-scrim p-8 outline-none"
    >
      <img src={url} alt={name} className="max-h-full max-w-full rounded-lg shadow-popover" />
    </div>,
    document.body,
  )
}

/** 补充框：文字 + 勾选项 + 截图；已关闭时提示发送会重新打开 */
function ReplyBox({
  threadId,
  closed,
  onSent,
  onFailed,
}: {
  threadId: string
  closed: boolean
  onSent: (detail: FeedbackDetail) => void
  onFailed: (e: unknown) => void
}) {
  useI18n()
  const [body, setBody] = useState('')
  const [value, setValue] = useState<AttachmentValue>({
    diagnostics: false,
    logs: false,
    range: '2h',
    includeError: false,
  })
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const images = useFeedbackImages()
  const preview = useFeedbackPreview(value.logs, value.range, null)

  let reason: LimitReason | null = checkReply({ body, images: images.images.length })
  if (!reason && value.logs && preview.loading) reason = { code: 'previewing' }
  if (!reason && value.logs && preview.error) reason = { code: 'previewFailed' }

  const send = async (): Promise<void> => {
    if (reason || busy) return
    setBusy(true)
    setFailure(null)
    try {
      const detail = await feedbackApi().reply(threadId, {
        body: body.trim(),
        diagnostics: value.diagnostics,
        logs: value.logs ? preview.data?.logs?.text || null : null,
        images: toImageInputs(images.images),
        error: null,
      })
      setBody('')
      setValue(v => ({ ...v, diagnostics: false, logs: false }))
      images.clear()
      void feedbackApi()
        .refresh()
        .catch(() => {})
      onSent(detail)
    } catch (e) {
      setFailure(translateMessage(errorText(e)))
      if (isAuthExpired(e)) onFailed(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-feedback-reply onPaste={images.onPaste} className="mt-6 border-t border-line pt-4">
      {closed && <p className="mb-2 text-meta text-fg-muted">{tr('feedback.thread.reopenHint')}</p>}
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder={tr('feedback.thread.replyPlaceholder')}
        aria-label={tr('feedback.thread.replyPlaceholder')}
        rows={3}
        className={`${INPUT_CLASS} resize-y py-2`}
      />
      <div className="mt-3">
        <AttachmentOptions
          value={value}
          onChange={patch => setValue(v => ({ ...v, ...patch }))}
          preview={preview}
          hasAround={false}
          error={null}
          showTitle={false}
        />
      </div>
      <div className="mt-2">
        <ImageField state={images} hint={false} />
      </div>
      {failure && (
        <p role="alert" className="selectable mt-3 rounded-md bg-subtle px-3 py-2 text-meta break-all text-danger">
          {failure}
        </p>
      )}
      <div className="mt-3 flex items-center justify-end gap-3">
        {reason && body.trim() !== '' && !busy && (
          <span className="min-w-0 truncate text-meta text-fg-faint">{reasonText(reason)}</span>
        )}
        <Button variant="primary" onClick={() => void send()} disabled={!!reason || busy}>
          {busy ? tr('feedback.thread.sending') : tr('feedback.thread.send')}
        </Button>
      </div>
    </div>
  )
}
