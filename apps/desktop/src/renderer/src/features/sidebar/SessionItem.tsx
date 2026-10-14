import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { cn } from '@/ui'
import { NeedsYouLabel, SessionMarks, SessionStatusMark } from './SessionMarks'
import { needsYou } from './projectTreeModel'
import type { SessionLane } from '@/features/board/sessionLanes'
import { LANE_LABEL, LANE_TONE } from './RunStatusPill'
import type { Session } from '@/data'
import { SessionRow } from './SessionRow'
import { useSessionChannel } from '@/features/channels/store'

/**
 * 项目下面的对话（docs/ui/sidebar-styles.md「大文件夹」版）：标题和项目名对齐，状态挂在项目文件夹图标正下方，
 * 右边是时间（要你处理的写「等你 / 出错 / 暂停」）；新回复的标题用主色加粗，当前打开的有底色
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
  const fresh = unread || lane === 'unread'
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
      className="[&>button]:pl-[28px]"
      trailing={
        reason && lane ? (
          <span className={cn('shrink-0 text-meta', LANE_TONE[lane])}>{tr(LANE_LABEL[lane])}</span>
        ) : needsYou(lane) ? (
          <NeedsYouLabel lane={lane} />
        ) : (
          <SessionMarks running={running} unread={unread} time={session.time} />
        )
      }
    >
      <SessionStatusMark lane={lane} running={running} unread={fresh} />
      <span className={cn('min-w-0 truncate', !channel && 'flex-1', fresh && 'font-semibold text-accent-fg')}>
        {session.title}
      </span>
      {channel && <span className="max-w-[45%] shrink-0 truncate text-meta text-fg-faint"># {channel}</span>}
    </SessionRow>
  )
}
