import { useI18n } from '@/i18n/I18nProvider'
import { Dot, Spinner, cn } from '@/ui'
import type { Session } from '@/data'
import { SessionRow } from './SessionRow'
import { useSessionChannel } from '@/features/channels/store'

/** 项目下面缩进的会话：文字与项目名对齐 */
export function SessionItem({
  session,
  selected,
  onSelect,
}: {
  session: Session
  selected: boolean
  onSelect: (id: string) => void
}) {
  useI18n()
  const running = session.status === 'running'
  const unread = session.status === 'unread'
  // 协作频道派活开出来的会话（docs/ui/channels-phase-b.md §2.4）
  const channel = useSessionChannel(session.id)
  return (
    <SessionRow
      target={{
        id: session.id,
        title: session.title,
        bottomed: !!session.bottomedAt,
        pinned: !!session.pinnedAt,
        archived: !!session.archivedAt,
        running,
      }}
      selected={selected}
      onSelect={onSelect}
      className="[&>button]:pl-9"
      trailing={
        <>
          {unread && <Dot tone="accent" className="mr-0.5" />}
          {running && <Spinner size={14} />}
          {!unread && !running && session.time && (
            <span className="shrink-0 text-meta text-fg-faint">{session.time}</span>
          )}
        </>
      }
    >
      <span className={cn('min-w-0 truncate', !channel && 'flex-1', unread && 'font-semibold text-fg')}>
        {session.title}
      </span>
      {channel && <span className="max-w-[45%] shrink-0 truncate text-meta text-fg-faint"># {channel}</span>}
    </SessionRow>
  )
}
