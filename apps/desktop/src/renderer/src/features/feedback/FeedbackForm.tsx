// 设置 › 反馈 › 新反馈（docs/ui/feedback.md §2.3）
import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { Button, Segmented } from '@/ui'
import {
  FEEDBACK_LIMITS,
  type FeedbackDetail,
  type FeedbackErrorSnippet,
  type FeedbackType,
} from '../../../../shared/types/feedback'
import { AttachmentOptions } from './AttachmentOptions'
import { clearDraft, loadDraft, saveDraft, type LogWindow } from './draft'
import type { FeedbackPrefill } from './focus'
import { ImageField, toImageInputs, useFeedbackImages } from './ImageField'
import { checkCreate, clipErrorText, composeBody, errorText, isAuthExpired, type LimitReason } from './logic'
import { feedbackApi } from './store'
import { useFeedbackPreview } from './usePreview'

export const INPUT_CLASS =
  'w-full rounded-md border border-line bg-surface px-3 text-list text-fg outline-none placeholder:text-fg-faint focus:border-accent'

const BODY_PLACEHOLDER: Record<FeedbackType, () => string> = {
  bug: () => tr('feedback.form.bodyBug'),
  feature: () => tr('feedback.form.bodyFeature'),
  other: () => tr('feedback.form.bodyOther'),
}

export const reasonText = (reason: LimitReason): string => {
  switch (reason.code) {
    case 'titleEmpty':
      return tr('feedback.limit.titleEmpty')
    case 'bodyEmpty':
      return tr('feedback.limit.bodyEmpty')
    case 'previewing':
      return tr('feedback.limit.preparing')
    case 'previewFailed':
      return tr('feedback.limit.previewFailed')
    case 'titleLong':
      return tr('feedback.limit.titleLong', { p0: reason.limit })
    case 'bodyLong':
      return tr('feedback.limit.bodyLong', { p0: reason.limit })
    case 'images':
      return tr('feedback.limit.images', { p0: reason.limit })
  }
}

export function FeedbackForm({
  email,
  prefill,
  onCancel,
  onDone,
  onFailed,
}: {
  email: string
  prefill: FeedbackPrefill | null
  onCancel: () => void
  onDone: (detail: FeedbackDetail) => void
  /** 提交出错（登录过期时让页面刷新状态） */
  onFailed: (e: unknown) => void
}) {
  useI18n()
  const [initial] = useState(() => {
    const draft = loadDraft(email)
    const wantsLogs = !!(prefill?.logs || prefill?.logsSince || prefill?.error)
    return {
      ...draft,
      type: prefill?.type ?? draft.type,
      logs: wantsLogs ? true : draft.logs,
      window: prefill?.logsSince ? ('around' as const) : draft.window,
    }
  })
  const [type, setType] = useState<FeedbackType>(initial.type)
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [steps, setSteps] = useState(initial.steps)
  const [diagnostics, setDiagnostics] = useState(initial.diagnostics)
  const [logsFlag, setLogsFlag] = useState<boolean | null>(initial.logs)
  const [range, setRange] = useState<LogWindow>(initial.window)
  const [error] = useState<FeedbackErrorSnippet | null>(prefill?.error ?? null)
  const [includeError, setIncludeError] = useState(true)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const images = useFeedbackImages()

  const around = prefill?.logsSince ?? null
  const logsOn = logsFlag ?? type === 'bug'
  const effectiveRange: LogWindow = range === 'around' && around === null ? '2h' : range
  const preview = useFeedbackPreview(logsOn, effectiveRange, around)

  // 草稿（不存图片和日志原文）
  useEffect(() => {
    saveDraft(email, { type, title, body, steps, diagnostics, logs: logsFlag, window: range })
  }, [email, type, title, body, steps, diagnostics, logsFlag, range])

  const composed = composeBody(body, type === 'bug' ? steps : '', tr('feedback.form.steps'))
  let reason: LimitReason | null = checkCreate({ title, body, composed, images: images.images.length })
  if (!reason && logsOn && preview.loading) reason = { code: 'previewing' }
  if (!reason && logsOn && preview.error) reason = { code: 'previewFailed' }

  const submit = async (): Promise<void> => {
    if (reason || busy) return
    setBusy(true)
    setFailure(null)
    try {
      const detail = await feedbackApi().create({
        type,
        title: title.trim(),
        body: composed,
        diagnostics,
        logs: logsOn ? preview.data?.logs?.text || null : null,
        images: toImageInputs(images.images),
        error: error && includeError ? { ...error, text: clipErrorText(error.text) } : null,
      })
      clearDraft(email)
      void feedbackApi()
        .refresh()
        .catch(() => {})
      onDone(detail)
    } catch (e) {
      setFailure(translateMessage(errorText(e)))
      if (isAuthExpired(e)) onFailed(e)
      setBusy(false)
    }
  }

  return (
    <form
      data-feedback-form
      onPaste={images.onPaste}
      onDragEnter={images.onDragEnter}
      onDragOver={images.onDragOver}
      onDragLeave={images.onDragLeave}
      onDrop={images.onDrop}
      onSubmit={e => {
        e.preventDefault()
        void submit()
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex items-center gap-4">
        <span className="w-14 shrink-0 text-ui font-medium text-fg">{tr('feedback.type.label')}</span>
        <Segmented<FeedbackType>
          label={tr('feedback.type.label')}
          value={type}
          onChange={setType}
          options={[
            { value: 'bug', label: tr('feedback.type.bug') },
            { value: 'feature', label: tr('feedback.type.feature') },
            { value: 'other', label: tr('feedback.type.other') },
          ]}
        />
      </div>

      <label className="flex items-center gap-4">
        <span className="w-14 shrink-0 text-ui font-medium text-fg">{tr('feedback.form.title')}</span>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={tr('feedback.form.titlePlaceholder')}
          spellCheck={false}
          className={`${INPUT_CLASS} h-8 min-w-0 flex-1`}
        />
        <span className="w-14 shrink-0 text-right text-meta text-fg-faint tabular-nums">
          {[...title].length}/{FEEDBACK_LIMITS.titleChars}
        </span>
      </label>

      <label className="flex items-start gap-4">
        <span className="w-14 shrink-0 pt-1.5 text-ui font-medium text-fg">{tr('feedback.form.body')}</span>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={BODY_PLACEHOLDER[type]()}
          rows={6}
          className={`${INPUT_CLASS} min-w-0 flex-1 resize-y py-2`}
        />
      </label>

      {type === 'bug' && (
        <label className="flex items-start gap-4">
          <span className="w-14 shrink-0 pt-1.5 text-ui font-medium text-fg">{tr('feedback.form.steps')}</span>
          <textarea
            value={steps}
            onChange={e => setSteps(e.target.value)}
            placeholder={tr('feedback.form.stepsPlaceholder')}
            aria-label={tr('feedback.form.stepsOptional')}
            rows={3}
            className={`${INPUT_CLASS} min-w-0 flex-1 resize-y py-2`}
          />
        </label>
      )}

      <AttachmentOptions
        value={{ diagnostics, logs: logsOn, range: effectiveRange, includeError }}
        onChange={patch => {
          if (patch.diagnostics !== undefined) setDiagnostics(patch.diagnostics)
          if (patch.logs !== undefined) setLogsFlag(patch.logs)
          if (patch.range !== undefined) setRange(patch.range)
          if (patch.includeError !== undefined) setIncludeError(patch.includeError)
        }}
        preview={preview}
        hasAround={around !== null}
        error={error}
      />

      <ImageField state={images} />

      <div className="border-t border-line pt-4">
        <p className="mb-3 text-meta text-fg-muted">{tr('feedback.form.footer', { p0: email })}</p>
        {failure && (
          <p role="alert" className="selectable mb-3 rounded-md bg-subtle px-3 py-2 text-meta break-all text-danger">
            {failure}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          {reason && !busy && (
            <span data-feedback-reason className="min-w-0 truncate text-meta text-fg-faint">
              {reasonText(reason)}
            </span>
          )}
          <Button onClick={onCancel} disabled={busy}>
            {tr('feedback.form.cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={!!reason || busy}>
            {busy ? tr('feedback.form.submitting') : tr('feedback.form.submit')}
          </Button>
        </div>
      </div>
    </form>
  )
}
