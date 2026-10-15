// 反馈页几个视图共用的小部件：面包屑、类型标签、状态文字、时间
import type { ReactNode } from 'react'
import { Bug, ChevronLeft, Lightbulb, MessageCircle, type LucideIcon } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { getLocale, tr } from '@/i18n/core'
import { cn } from '@/ui'
import { isMac } from '../layout/keybindings'
import type { FeedbackSummary, FeedbackType } from '../../../../shared/types/feedback'
import { statusKind, type StatusKind } from './view'

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

/** 列表上的时间：今天只写时分，其他写日期 */
export function friendlyTime(ts: number): string {
  const date = new Date(ts)
  const now = new Date()
  if (date.toDateString() === now.toDateString())
    return tr('feedback.today', {
      p0: date.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', hour12: false }),
    })
  return formatTime(ts, false)
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

export const TYPE_ICON: Record<FeedbackType, LucideIcon> = { bug: Bug, feature: Lightbulb, other: MessageCircle }
const TYPE_TINT: Record<FeedbackType, string> = {
  bug: 'bg-danger/10 text-danger',
  feature: 'bg-warn/12 text-warn',
  other: 'bg-subtle text-fg-secondary',
}

/** 类型图标方块（列表卡片、详情标题左边） */
export function TypeIcon({ type, size = 32 }: { type: FeedbackType; size?: number }) {
  const Icon = TYPE_ICON[type]
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn('flex shrink-0 items-center justify-center rounded-md', TYPE_TINT[type])}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={1.6} />
    </span>
  )
}

/** 状态文字（列表和详情一致）：已关闭灰 / 已回复绿 / 团队处理中紫 / 团队已看到蓝 / 等待回复暖色 */
const STATUS: Record<StatusKind, { label: () => string; tone: string }> = {
  closed: { label: () => tr('feedback.status.closed'), tone: 'bg-subtle text-fg-faint' },
  replied: { label: () => tr('feedback.status.replied'), tone: 'bg-success/12 text-success' },
  working: { label: () => tr('feedback.status.working'), tone: 'bg-status-working/12 text-status-working' },
  seen: { label: () => tr('feedback.status.seen'), tone: 'bg-status-seen/12 text-status-seen' },
  waiting: { label: () => tr('feedback.status.open'), tone: 'bg-warn/12 text-warn' },
}

export function StatusWord({ thread }: { thread: Pick<FeedbackSummary, 'status' | 'working' | 'teamSeen'> }) {
  useI18n()
  const kind = statusKind(thread)
  return (
    <span
      data-feedback-status={thread.status}
      data-feedback-status-kind={kind}
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-label font-medium',
        STATUS[kind].tone,
      )}
    >
      {STATUS[kind].label()}
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

/** 发送快捷键提示：Ctrl ↵ / ⌘↵ */
export const SEND_HINT = isMac ? '⌘↵' : 'Ctrl ↵'
