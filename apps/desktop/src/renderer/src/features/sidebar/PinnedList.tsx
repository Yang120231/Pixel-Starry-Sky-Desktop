import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Pin } from 'lucide-react'
import { cn } from '@/ui'
import { SessionMarks, StatusLabel, ringOf } from './SessionMarks'
import { StatusHover } from './SessionStatusCard'
import { useRowStatus } from './useRowStatus'
import type { PinnedSession } from '@/features/engine/sidebarData'
import { SessionRow } from './SessionRow'
import type { SessionCard, SessionLane } from '@/features/board/sessionLanes'
import { LANE_LABEL, LANE_TONE } from './RunStatusPill'

/** 侧栏「置顶」分组：置顶的会话（会话菜单里「置顶」，取消也在同一个菜单里；任务看板入口在 SidebarNav） */
export function PinnedList({
  sessions,
  selectedSessionId,
  onSelectSession,
  lanes,
  cards,
}: {
  sessions: PinnedSession[]
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
  /** 侧栏按状态筛选时：右边写原因 */
  lanes?: ReadonlyMap<string, SessionLane>
  /** 看板卡片：问题类状态（等你 / 要登录 / 出错…）写在右边 */
  cards?: ReadonlyMap<string, SessionCard>
}) {
  useI18n()
  return (
    <>
      {sessions.map(session => (
        <PinnedRow
          key={session.id}
          session={session}
          selected={session.id === selectedSessionId}
          onSelect={onSelectSession}
          lane={lanes?.get(session.id)}
          card={cards?.get(session.id)}
        />
      ))}
    </>
  )
}

/**
 * 置顶行：左边是图钉不变；右边有问题时写字（前面 13px 小图标），有 PR 时 13px 的 PR 图标放在时间前面
 * （docs/ui/sidebar-status-icons.md §5）。鼠标停在行上弹状态详情
 */
function PinnedRow({
  session,
  selected,
  onSelect,
  lane,
  card,
}: {
  session: PinnedSession
  selected: boolean
  onSelect: (id: string) => void
  lane: SessionLane | undefined
  card: SessionCard | undefined
}) {
  const running = session.status === 'running'
  const unread = session.status === 'unread'
  const status = useRowStatus(session.id, { card, running, unread })
  const ring = ringOf(selected)
  const content = (
    <>
      <Pin size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
      <span
        className={cn('min-w-0 flex-1 truncate', unread && 'font-semibold text-fg')}
        title={session.project ? `${session.title} · ${session.project}` : session.title}
      >
        {session.title}
      </span>
    </>
  )
  return (
    <SessionRow
      target={{ id: session.id, title: session.title, pinned: true, archived: false, running }}
      selected={selected}
      onSelect={onSelect}
      trailing={
        lane ? (
          <span className={cn('shrink-0 text-meta', LANE_TONE[lane])}>{tr(LANE_LABEL[lane])}</span>
        ) : status.label ? (
          <StatusLabel status={status} ring={ring} icon />
        ) : (
          <SessionMarks
            running={running}
            unread={unread}
            time={session.time}
            lead={false}
            status={status}
            ring={ring}
          />
        )
      }
    >
      <StatusHover
        sessionId={session.id}
        title={session.title}
        status={status}
        card={card}
        className="flex min-w-0 flex-1 items-center gap-2.5"
      >
        {content}
      </StatusHover>
    </SessionRow>
  )
}
