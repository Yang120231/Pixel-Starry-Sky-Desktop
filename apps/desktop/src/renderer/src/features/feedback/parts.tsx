// 反馈页几个视图共用的小部件：面包屑、类型标签、状态文字、时间
import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { getLocale, tr } from '@/i18n/core'
import { cn } from '@/ui'
import type { FeedbackStatus, FeedbackType } from '../../../../shared/types/feedback'

/** 「10月12日 14:03」；不是今年的带年份 */
export function formatTime(ts: number, withTime = true): string {
  const date = new Date(ts)
  return date.toLocaleString(getLocale(), {
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  })
}

const TYPE_LABEL: Record<FeedbackType, () => string> = {
  bug: () => tr('feedback.type.bug'),
  feature: () => tr('feedback.type.feature'),
  other: () => tr('feedback.type.other'),
}

export function TypeChip({ type }: { type: FeedbackType }) {
  useI18n()
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded bg-subtle px-1.5 text-label text-fg-secondary">
      {TYPE_LABEL[type]()}
    </span>
  )
}

const STATUS: Record<FeedbackStatus, { label: () => string; tone: string }> = {
  open: { label: () => tr('feedback.status.open'), tone: 'text-fg-muted' },
  replied: { label: () => tr('feedback.status.replied'), tone: 'font-medium text-accent-fg' },
  closed: { label: () => tr('feedback.status.closed'), tone: 'text-fg-faint' },
}

export function StatusWord({ status }: { status: FeedbackStatus }) {
  useI18n()
  return (
    <span data-feedback-status={status} className={cn('shrink-0 text-meta', STATUS[status].tone)}>
      {STATUS[status].label()}
    </span>
  )
}

/** 面包屑「‹ 反馈 › …」：点「反馈」回列表 */
export function Crumbs({ current, onBack, right }: { current: string; onBack: () => void; right?: ReactNode }) {
  useI18n()
  return (
    <div className="mb-5 flex items-center gap-3">
      <nav
        aria-label={tr('feedback.title')}
        className="flex min-w-0 flex-1 items-center gap-1 text-section font-semibold"
      >
        <button
          type="button"
          onClick={onBack}
          className="press -ml-1 inline-flex shrink-0 items-center gap-0.5 rounded-md px-1 text-fg-muted hover:bg-hover hover:text-fg"
        >
          <ChevronLeft size={16} />
          {tr('feedback.title')}
        </button>
        <span aria-hidden className="text-fg-faint">
          ›
        </span>
        <span className="min-w-0 truncate text-fg" title={current}>
          {current}
        </span>
      </nav>
      {right}
    </div>
  )
}
