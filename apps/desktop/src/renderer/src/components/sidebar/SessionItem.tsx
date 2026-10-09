import { useI18n } from '@/i18n/I18nProvider'
import { Dot, Spinner, cn } from '@/components/ui'
import type { Session } from '@/data'
import { SessionRow } from './SessionRow'

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
  return (
    <SessionRow
      target={{
        id: session.id,
        title: session.title,
        bottomed: !!session.bottomedAt,
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
      <span className={cn('min-w-0 flex-1 truncate', unread && 'font-semibold text-fg')}>{session.title}</span>
    </SessionRow>
  )
}
