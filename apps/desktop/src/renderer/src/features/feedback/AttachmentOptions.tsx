// 「附带信息」勾选项（docs/ui/feedback.md §2.3）：诊断信息、最近日志、出错的对话。预览里显示的就是将发送的原文
import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { Select, Spinner, cn } from '@/ui'
import type { FeedbackErrorSnippet } from '../../../../shared/types/feedback'
import type { LogWindow } from './draft'
import { sizeText } from './logic'
import type { PreviewState } from './usePreview'

export interface AttachmentValue {
  diagnostics: boolean
  logs: boolean
  range: LogWindow
  includeError: boolean
}

/** 等宽、可滚动的原文框 */
export function TextBox({ text, label }: { text: string; label: string }) {
  return (
    <pre
      aria-label={label}
      tabIndex={0}
      className="selectable mt-2 max-h-[240px] overflow-auto rounded-md border border-line bg-subtle px-3 py-2 font-mono text-meta break-all whitespace-pre-wrap text-fg-secondary"
    >
      {text}
    </pre>
  )
}

function Row({
  checked,
  onChange,
  bare,
  title,
  detail,
  action,
  children,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  /** 不要勾选框（补充框里由底下的开关小按钮控制开关） */
  bare?: boolean
  title: string
  detail?: ReactNode
  action?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="py-2.5">
      <div className="flex min-h-7 items-center gap-2.5">
        {bare ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="shrink-0 text-ui font-medium text-fg">{title}</span>
            <span className="min-w-0 truncate text-meta text-fg-muted">{detail}</span>
          </div>
        ) : (
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
            <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="shrink-0" />
            <span className="shrink-0 text-ui font-medium text-fg">{title}</span>
            <span className="min-w-0 truncate text-meta text-fg-muted">{detail}</span>
          </label>
        )}
        {action}
      </div>
      {children}
    </div>
  )
}

function Toggle({ open, onClick, children }: { open: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className="press inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-meta text-fg-secondary hover:bg-hover hover:text-fg"
    >
      {children}
      <ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
    </button>
  )
}

export function AttachmentOptions({
  value,
  onChange,
  preview,
  hasAround,
  error,
  showTitle = true,
  rows = ['diagnostics', 'logs', 'error'],
  bare = false,
  box = false,
  footer,
}: {
  value: AttachmentValue
  onChange: (patch: Partial<AttachmentValue>) => void
  preview: PreviewState
  /** 从报错进来才有「本轮出错前后」 */
  hasAround: boolean
  /** 从报错进来才有「出错的对话」 */
  error: FeedbackErrorSnippet | null
  showTitle?: boolean
  /** 只显示哪几行（补充框里按开关展开对应的一行） */
  rows?: Array<'diagnostics' | 'logs' | 'error'>
  /** 行里不放勾选框 */
  bare?: boolean
  /** 外面套一个带边框的框（新反馈的「会一并发送」） */
  box?: boolean
  /** 框里最后一行（截图、隐私说明） */
  footer?: ReactNode
}) {
  useI18n()
  const [diagOpen, setDiagOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [errorOpen, setErrorOpen] = useState(false)
  const data = preview.data
  const logs = value.logs ? (data?.logs ?? null) : null
  const diag = data?.diagnostics
  const pending = preview.loading && !data
  const failed = preview.error ? tr('feedback.attach.failed', { p0: translateMessage(preview.error) }) : null

  const diagDetail = diag
    ? tr('feedback.attach.diagSummary', {
        p0: diag.appVersion,
        p1: diag.os,
        p2: diag.arch,
        p3: diag.engines.length,
      })
    : pending
      ? tr('feedback.attach.preparing')
      : null
  const logsDetail = !value.logs
    ? null
    : preview.loading
      ? tr('feedback.attach.preparing')
      : logs
        ? logs.lines
          ? tr('feedback.attach.logsSummary', { p0: logs.lines, p1: sizeText(logs.bytes) })
          : tr('feedback.attach.logsNone')
        : null

  const options: Array<{ value: LogWindow; label: string }> = [
    ...(hasAround ? [{ value: 'around' as const, label: tr('feedback.attach.windowAround') }] : []),
    { value: '30m', label: tr('feedback.attach.window30m') },
    { value: '2h', label: tr('feedback.attach.window2h') },
    { value: '24h', label: tr('feedback.attach.window24h') },
  ]

  return (
    <div data-feedback-attachments className={cn(box && 'rounded-lg border border-line bg-subtle/50 px-4 py-3')}>
      {showTitle && (
        <h4 className={cn('pb-1.5 text-label font-medium text-fg-muted', !box && 'border-b border-line')}>
          <span className={cn(box && 'text-ui text-fg')}>{tr('feedback.attach.title')}</span>
          {box && <span className="ml-2 text-meta font-normal text-fg-faint">{tr('feedback.attach.titleHint')}</span>}
        </h4>
      )}
      <div className="divide-y divide-line-subtle">
        {rows.includes('diagnostics') && (
          <Row
            bare={bare}
            checked={value.diagnostics}
            onChange={v => onChange({ diagnostics: v })}
            title={tr('feedback.attach.diagnostics')}
            detail={diagDetail}
            action={
              diag && (
                <Toggle open={diagOpen} onClick={() => setDiagOpen(o => !o)}>
                  {tr('feedback.attach.view')}
                </Toggle>
              )
            }
          >
            {diagOpen && data && <TextBox text={data.diagnosticsText} label={tr('feedback.attach.diagnostics')} />}
          </Row>
        )}

        {rows.includes('logs') && (
          <Row
            bare={bare}
            checked={value.logs}
            onChange={v => onChange({ logs: v })}
            title={tr('feedback.attach.logs')}
            detail={logsDetail}
            action={
              value.logs && (
                <div className="flex shrink-0 items-center gap-1">
                  <Select<LogWindow>
                    label={tr('feedback.attach.logsWindow')}
                    value={value.range}
                    onChange={range => onChange({ range })}
                    options={options}
                    fitContent
                  />
                  {logs && logs.lines > 0 && (
                    <Toggle open={logsOpen} onClick={() => setLogsOpen(o => !o)}>
                      {tr('feedback.attach.preview')}
                    </Toggle>
                  )}
                </div>
              )
            }
          >
            {value.logs && preview.loading && (
              <p className="mt-1 flex items-center gap-1.5 pl-6 text-meta text-fg-muted">
                <Spinner size={12} />
                {tr('feedback.attach.preparing')}
              </p>
            )}
            {value.logs && logs?.truncated && (
              <p className="mt-1 pl-6 text-meta text-warn">{tr('feedback.attach.logsTruncated')}</p>
            )}
            {logsOpen && logs && logs.lines > 0 && <TextBox text={logs.text} label={tr('feedback.attach.sentText')} />}
          </Row>
        )}

        {rows.includes('error') && error && (
          <Row
            bare={bare}
            checked={value.includeError}
            onChange={v => onChange({ includeError: v })}
            title={tr('feedback.attach.error')}
            detail={`${error.text.replace(/\s+/g, ' ').slice(0, 60)} · ${tr('feedback.attach.session', { p0: error.sessionId })} · ${new Date(error.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`}
            action={
              <Toggle open={errorOpen} onClick={() => setErrorOpen(o => !o)}>
                {tr('feedback.attach.view')}
              </Toggle>
            }
          >
            <p className="mt-1 pl-6 text-meta text-fg-faint">{tr('feedback.attach.errorNote')}</p>
            {errorOpen && <TextBox text={error.text} label={tr('feedback.attach.error')} />}
          </Row>
        )}
        {footer}
      </div>
      {failed && (
        <p className="selectable mt-1 flex items-center gap-2 text-meta text-danger">
          <span className="min-w-0 break-all">{failed}</span>
          <button type="button" onClick={preview.reload} className="shrink-0 text-accent hover:underline">
            {tr('feedback.retry')}
          </button>
        </p>
      )}
    </div>
  )
}
