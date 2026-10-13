import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { cn } from '@/ui'
import type { ConversationEntry } from '../sessionsModel'

type DotStatus = 'idle' | 'running' | 'unread' | 'waiting' | 'failed'

const DOT_COLOR: Record<DotStatus, string> = {
  idle: 'bg-fg-faint',
  running: 'bg-success',
  unread: 'bg-accent',
  waiting: 'bg-warn',
  failed: 'bg-danger',
}

/** 6px 状态圆点；运行中带呼吸 */
export function StatusDot({ status }: { status: DotStatus }) {
  useI18n()
  return (
    <span
      role="img"
      aria-label={tr('coding.shell.statusDot', { status: tr(`coding.shell.status.${status}`) })}
      className={cn('inline-block size-1.5 shrink-0 rounded-full', DOT_COLOR[status])}
    />
  )
}

/** 状态点 + 标题 + 时间，当前会话高亮；L2、R、T 共用 */
export function ConversationRow({
  entry,
  active,
  onSelect,
}: {
  entry: ConversationEntry
  active: boolean
  onSelect(id: string): void
}) {
  useI18n()
  return (
    <button
      type="button"
      data-coding-conversation={entry.id}
      aria-current={active || undefined}
      title={entry.title}
      onClick={() => onSelect(entry.id)}
      className={cn(
        'press no-drag flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-ui text-fg',
        active ? 'bg-selected' : 'hover:bg-hover',
      )}
    >
      <span className="flex w-3 shrink-0 justify-center">
        <StatusDot status={entry.status} />
      </span>
      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
      {entry.time ? <span className="shrink-0 text-meta text-fg-faint">{entry.time}</span> : null}
    </button>
  )
}
