import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage, type TranslationKey } from '../../i18n/core'
import { useState } from 'react'
import { CircleCheck, CirclePause, CircleX, Clock, ShieldAlert, Unplug, type LucideIcon } from 'lucide-react'
import { Button, cn, DiffStat, Spinner, useToast } from '@/ui'
import { canAnswerInline } from '@/features/panel/inbox/inboxModel'
import type { ChannelMember, ChannelTask, ChannelTaskStatus } from '@/data/types'
import type { ChannelTaskAction } from '../../../../shared/types/channels'
import { formatClock } from './format'
import { agentPlace } from './ChannelMessage'

const STATUS_LABEL: Record<ChannelTaskStatus, TranslationKey> = {
  queued: 'channels.task.queued',
  running: 'channels.task.running',
  waiting: 'channels.task.waiting',
  done: 'channels.task.done',
  failed: 'channels.task.failed',
  stopped: 'channels.task.stopped',
}
const STATUS_ICON: Record<Exclude<ChannelTaskStatus, 'running'>, { icon: LucideIcon; className: string }> = {
  queued: { icon: Clock, className: 'text-fg-faint' },
  waiting: { icon: ShieldAlert, className: 'text-warn' },
  done: { icon: CircleCheck, className: 'text-success' },
  failed: { icon: CircleX, className: 'text-danger' },
  stopped: { icon: CirclePause, className: 'text-fg-faint' },
}

export interface TaskCardActions {
  onOpenSession: (sessionId: string) => void
  /** 正式模式才有：取消 / 停止 / 重试 */
  onAction?: (taskId: string, action: ChannelTaskAction) => Promise<void>
  /** 等你确认：允许 / 拒绝（engine:answer） */
  onAnswer?: (task: ChannelTask, allow: boolean) => Promise<void>
  /** 追加要求：放一条引用这张卡的引用条 */
  onFollowUp?: (taskId: string) => void
}

/** 状态后面的补充：排队位置、计划进度、取消 */
function statusDetail(task: ChannelTask): string | null {
  if (task.status === 'queued' && task.ahead) return tr('channels.task.ahead', { count: task.ahead })
  if ((task.status === 'running' || task.status === 'waiting') && task.progress)
    return tr('channels.task.progress', { done: task.progress.done, total: task.progress.total })
  if (task.status === 'stopped' && task.note === 'cancelled') return tr('channels.task.cancelled')
  return null
}

/** 派给 AI 成员的一项活（docs/ui/channels.md §5.2，Phase B 改动见 channels-phase-b.md §6），状态变化时原地更新 */
export function ChannelTaskCard({
  task,
  membersById,
  onOpenSession,
  onAction,
  onAnswer,
  onFollowUp,
}: {
  task: ChannelTask
  membersById: ReadonlyMap<string, ChannelMember>
} & TaskCardActions) {
  useI18n()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const assignee = membersById.get(task.assigneeId)
  const author = membersById.get(task.authorId)
  const place = agentPlace(assignee)
  const status = task.status === 'running' ? null : STATUS_ICON[task.status]
  const detail = statusDetail(task)
  const live = !!onAction
  const inline = task.status === 'waiting' && canAnswerInline(task.request ?? null)
  const run = (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    fn()
      .catch(error => toast(tr('channels.task.actionFailed', { error: translateMessage((error as Error).message) })))
      .finally(() => setBusy(false))
  }
  const open = task.sessionId ? () => onOpenSession(task.sessionId!) : null
  const meta = [task.round && task.round > 1 ? tr('channels.task.round', { count: task.round }) : '', place]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="conversation-message mt-3 pl-10" data-channel-message={task.id}>
      <article
        aria-label={`${tr(STATUS_LABEL[task.status])}：${task.title}`}
        className={cn(
          'max-w-[560px] rounded-lg border border-line-card bg-surface p-3 shadow-sm',
          (task.status === 'waiting' || task.decision) && 'border-warn/40',
        )}
      >
        <div className="flex items-center gap-2 text-meta">
          {status ? (
            <status.icon size={14} strokeWidth={1.75} className={cn('shrink-0', status.className)} />
          ) : (
            <Spinner size={13} />
          )}
          <span
            className={cn(
              'shrink-0 font-medium',
              task.status === 'waiting' ? 'text-warn' : task.status === 'failed' ? 'text-danger' : 'text-fg-muted',
            )}
          >
            {tr(STATUS_LABEL[task.status])}
            {detail && <span className="font-normal text-fg-faint"> · {detail}</span>}
          </span>
          <span className="min-w-0 flex-1 truncate text-fg-faint">
            {tr('channels.task.assigned', { author: author?.name ?? '?', assignee: assignee?.name ?? '?' })}
          </span>
          <time dateTime={new Date(task.at).toISOString()} className="shrink-0 text-fg-faint tabular-nums">
            {formatClock(task.at)}
          </time>
        </div>
        <div className="mt-1.5 text-list font-medium break-words text-fg">{task.title}</div>
        {task.summary && <p className="mt-1 text-list break-words text-fg-secondary">{task.summary}</p>}
        {task.status === 'failed' && task.error && (
          <p className="mt-1 line-clamp-3 text-meta break-words text-danger" title={translateMessage(task.error)}>
            {translateMessage(task.error)}
          </p>
        )}
        {task.status === 'waiting' && task.request && (
          <p
            className={cn('mt-1 line-clamp-2 text-meta break-words text-fg-muted', task.request.command && 'font-mono')}
            title={task.request.command ?? task.request.title}
          >
            {task.request.command?.trim() || task.request.questions?.[0]?.question || task.request.title}
          </p>
        )}
        {task.decision && (
          <p className="mt-1.5 text-list break-words text-warn">
            {tr('channels.task.decision', { text: task.decision })}
          </p>
        )}
        {task.disconnected && (
          <p className="mt-1 flex items-center gap-1.5 text-meta text-fg-muted">
            <Unplug size={12} strokeWidth={1.75} className="shrink-0" />
            {tr('channels.task.disconnected')}
          </p>
        )}
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-meta text-fg-faint">
          {meta && <span className="min-w-0 truncate">{meta}</span>}
          {task.diff && <DiffStat added={task.diff.added} removed={task.diff.removed} className="shrink-0" />}
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
            {live && task.status === 'queued' && (
              <Button
                variant="ghost"
                className="h-7 px-2.5 text-meta"
                disabled={busy}
                onClick={() => run(() => onAction!(task.id, 'cancel'))}
              >
                {tr('channels.task.cancel')}
              </Button>
            )}
            {live && task.status === 'running' && (
              <Button
                variant="ghost"
                className="h-7 px-2.5 text-meta"
                disabled={busy}
                onClick={() => run(() => onAction!(task.id, 'stop'))}
              >
                {tr('channels.task.stop')}
              </Button>
            )}
            {live && inline && onAnswer && (
              <>
                <Button
                  variant="primary"
                  className="h-7 px-2.5 text-meta"
                  disabled={busy}
                  onClick={() => run(() => onAnswer(task, true))}
                >
                  {tr('channels.task.allow')}
                </Button>
                {task.request?.canDeny !== false && (
                  <Button
                    className="h-7 px-2.5 text-meta"
                    disabled={busy}
                    onClick={() => run(() => onAnswer(task, false))}
                  >
                    {tr('channels.task.deny')}
                  </Button>
                )}
              </>
            )}
            {live && task.status === 'waiting' && !inline && open && (
              <Button variant="primary" className="h-7 px-2.5 text-meta" onClick={open}>
                {tr('channels.task.answer')}
              </Button>
            )}
            {live && (task.status === 'failed' || task.status === 'stopped') && (
              <Button
                className="h-7 px-2.5 text-meta"
                disabled={busy}
                onClick={() => run(() => onAction!(task.id, 'retry'))}
              >
                {tr('channels.task.retry')}
              </Button>
            )}
            {live && task.status === 'done' && onFollowUp && (
              <Button variant="ghost" className="h-7 px-2.5 text-meta" onClick={() => onFollowUp(task.id)}>
                {tr('channels.task.followUp')}
              </Button>
            )}
            {open && (live || task.status !== 'waiting') && (
              <Button variant="outline" className="h-7 px-2.5 text-meta" onClick={open}>
                {tr('channels.openSession')}
              </Button>
            )}
            {!live && open && task.status === 'waiting' && (
              <Button variant="outline" className="h-7 px-2.5 text-meta" onClick={open}>
                {tr('channels.approve')}
              </Button>
            )}
          </div>
        </div>
      </article>
    </div>
  )
}
