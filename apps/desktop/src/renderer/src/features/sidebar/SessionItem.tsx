import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { cn } from '@/ui'
import { SessionMarks, SessionStatusMark } from './SessionMarks'
import type { SessionLane } from '@/features/board/sessionLanes'
import { LANE_LABEL, LANE_TONE } from './RunStatusPill'
import type { Session } from '@/data'
import { SessionRow } from './SessionRow'
import { useSessionChannel } from '@/features/channels/store'

/**
 * 项目下面挂在竖线上的对话（docs/ui/sidebar-hierarchy.md）：标题左边是状态，右边是时间；
 * 当前打开的那个左边一道主题色，压在竖线上
 */
export function SessionItem({
  session,
  selected,
  onSelect,
  lane,
  reason,
}: {
  session: Session
  selected: boolean
  onSelect: (id: string) => void
  /** 看板 / 胶囊里的分类，决定标题左边的状态 */
  lane?: SessionLane
  /** 侧栏按状态筛选时：右边写原因（等你处理 / 出错 / 运行中…），代替时间 */
  reason?: boolean
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
      className={cn(
        '[&>button]:gap-2 [&>button]:pl-1.5',
        selected &&
          'before:absolute before:top-1.5 before:bottom-1.5 before:-left-[7px] before:w-0.5 before:rounded-full before:bg-accent',
      )}
      trailing={
        reason && lane ? (
          <span className={cn('shrink-0 text-meta', LANE_TONE[lane])}>{tr(LANE_LABEL[lane])}</span>
        ) : (
          <SessionMarks running={running} unread={unread} time={session.time} />
        )
      }
    >
      <SessionStatusMark lane={lane} running={running} unread={unread || lane === 'unread'} />
      <span className={cn('min-w-0 truncate', !channel && 'flex-1', unread && 'font-semibold text-fg')}>
        {session.title}
      </span>
      {channel && <span className="max-w-[45%] shrink-0 truncate text-meta text-fg-faint"># {channel}</span>}
    </SessionRow>
  )
}
