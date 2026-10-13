import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Pin } from 'lucide-react'
import { cn } from '@/ui'
import { SessionMarks } from './SessionMarks'
import type { PinnedSession } from '@/features/engine/sidebarData'
import { SessionRow } from './SessionRow'
import type { SessionLane } from '@/features/board/sessionLanes'
import { LANE_LABEL, LANE_TONE } from './RunStatusPill'

/** 侧栏「置顶」分组：置顶的会话（会话菜单里「置顶」，取消也在同一个菜单里；任务看板入口在 SidebarNav） */
export function PinnedList({
  sessions,
  selectedSessionId,
  onSelectSession,
  lanes,
}: {
  sessions: PinnedSession[]
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
  /** 侧栏按状态筛选时：右边写原因 */
  lanes?: ReadonlyMap<string, SessionLane>
}) {
  useI18n()
  return (
    <>
      {sessions.map(session => {
        const running = session.status === 'running'
        const unread = session.status === 'unread'
        const lane = lanes?.get(session.id)
        return (
          <SessionRow
            key={session.id}
            target={{ id: session.id, title: session.title, pinned: true, archived: false, running }}
            selected={session.id === selectedSessionId}
            onSelect={onSelectSession}
            trailing={
              lane ? (
                <span className={cn('shrink-0 text-meta', LANE_TONE[lane])}>{tr(LANE_LABEL[lane])}</span>
              ) : (
                <SessionMarks running={running} unread={unread} time={session.time} lead={false} />
              )
            }
          >
            <Pin size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
            <span
              className={cn('min-w-0 flex-1 truncate', unread && 'font-semibold text-fg')}
              title={session.project ? `${session.title} · ${session.project}` : session.title}
            >
              {session.title}
            </span>
          </SessionRow>
        )
      })}
    </>
  )
}
