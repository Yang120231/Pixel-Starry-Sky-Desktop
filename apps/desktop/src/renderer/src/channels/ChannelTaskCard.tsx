import { useI18n } from '@/i18n/I18nProvider'
import { tr, type TranslationKey } from '../i18n/core'
import { CircleCheck, CircleX, Clock, ShieldAlert, type LucideIcon } from 'lucide-react'
import { Button, cn, DiffStat, Spinner } from '@/components/ui'
import type { ChannelMember, ChannelTask, ChannelTaskStatus } from '@/mock/types'
import { formatClock } from './format'

const STATUS_LABEL: Record<ChannelTaskStatus, TranslationKey> = {
  queued: 'channels.task.queued',
  running: 'channels.task.running',
  waiting: 'channels.task.waiting',
  done: 'channels.task.done',
  failed: 'channels.task.failed',
}
const STATUS_ICON: Record<Exclude<ChannelTaskStatus, 'running'>, { icon: LucideIcon; className: string }> = {
  queued: { icon: Clock, className: 'text-fg-faint' },
  waiting: { icon: ShieldAlert, className: 'text-warn' },
  done: { icon: CircleCheck, className: 'text-success' },
  failed: { icon: CircleX, className: 'text-danger' },
}

/** 派给 AI 成员的一项活（docs/ui/channels.md §5.2），状态变化时原地更新 */
export function ChannelTaskCard({ task, membersById, onOpenSession }: {
  task: ChannelTask
  membersById: ReadonlyMap<string, ChannelMember>
  onOpenSession: (sessionId: string) => void
}) {
  useI18n()
  const assignee = membersById.get(task.assigneeId)
  const author = membersById.get(task.authorId)
  const place = assignee?.kind === 'agent' ? [assignee.project, assignee.machine].filter(Boolean).join(' · ') : ''
  const status = task.status === 'running' ? null : STATUS_ICON[task.status]
  return (
    <div className="conversation-message mt-3 pl-10" data-channel-message={task.id}>
      <article aria-label={`${tr(STATUS_LABEL[task.status])}：${task.title}`}
        className={cn('max-w-[560px] rounded-lg border border-line-card bg-surface p-3 shadow-sm', task.status === 'waiting' && 'border-warn/40')}>
        <div className="flex items-center gap-2 text-meta">
          {status ? <status.icon size={14} strokeWidth={1.75} className={cn('shrink-0', status.className)} /> : <Spinner size={13} />}
          <span className={cn('shrink-0 font-medium', task.status === 'waiting' ? 'text-warn' : task.status === 'failed' ? 'text-danger' : 'text-fg-muted')}>{tr(STATUS_LABEL[task.status])}</span>
          <span className="min-w-0 flex-1 truncate text-fg-faint">{tr('channels.task.assigned', { author: author?.name ?? '?', assignee: assignee?.name ?? '?' })}</span>
          <time dateTime={new Date(task.at).toISOString()} className="shrink-0 text-fg-faint tabular-nums">{formatClock(task.at)}</time>
        </div>
        <div className="mt-1.5 text-list font-medium text-fg">{task.title}</div>
        {task.summary && <p className="mt-1 text-list break-words text-fg-secondary">{task.summary}</p>}
        {(place || task.diff || task.sessionId) && (
          <div className="mt-2 flex min-w-0 items-center gap-2 text-meta text-fg-faint">
            {place && <span className="min-w-0 truncate">{place}</span>}
            {task.diff && <DiffStat added={task.diff.added} removed={task.diff.removed} className="shrink-0" />}
            {task.sessionId && (
              <Button variant="outline" className="ml-auto h-7 px-2.5 text-meta" onClick={() => onOpenSession(task.sessionId!)}>
                {tr(task.status === 'waiting' ? 'channels.approve' : 'channels.openSession')}
              </Button>
            )}
          </div>
        )}
      </article>
    </div>
  )
}
