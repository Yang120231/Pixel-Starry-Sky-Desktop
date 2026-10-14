import { tr } from '@/i18n/core'
import { Dot, Spinner, cn } from '@/ui'
import { StatusDot } from '@/features/session/live/StatusDot'
import type { SessionLane } from '@/features/board/sessionLanes'
import { needsYou, type NeedsYouLane } from './projectTreeModel'

/**
 * 侧栏会话行右边一直写时间；项目里的对话状态在标题左边（SessionStatusMark）。正常和极简模式一样（docs/ui/minimal-mode.md）。
 * 置顶行左边是图钉，运行中的橙色圆点（和对话里的状态点同一套，docs/ui/conversation-concise.md §7.1）、新回复的点放右边、不写时间
 */
export function SessionMarks({
  running,
  unread,
  time,
  lead = true,
}: {
  running: boolean
  unread: boolean
  time?: string
  /** 标题左边有没有放 SessionStatusMark（置顶行左边是图钉，点还放右边） */
  lead?: boolean
}) {
  if (lead) return time ? <span className="shrink-0 text-meta text-fg-faint tabular-nums">{time}</span> : null
  return (
    <>
      {unread && <Dot tone="accent" className="mr-0.5" />}
      {running && <StatusDot status="running" />}
      {!unread && !running && time && <span className="shrink-0 text-meta text-fg-faint">{time}</span>}
    </>
  )
}

/**
 * 项目里对话标题左边的状态（docs/ui/sidebar-hierarchy.md）：转圈 = 在跑，「等你 / 出错 / 暂停」小标签 = 要你处理，
 * 主色点 = 有新回复。转圈和点放在固定 14px 的格子里，有没有状态的标题都对齐；标签比格子宽，标题往右让
 */
export function SessionStatusMark({
  lane,
  running,
  unread,
}: {
  lane: SessionLane | undefined
  running: boolean
  unread: boolean
}) {
  if (needsYou(lane))
    return (
      <span
        data-session-mark={lane}
        className={cn('shrink-0 rounded px-1 text-[10.5px] leading-4 font-semibold', TAG_TONE[lane])}
      >
        {tr(TAG_LABEL[lane])}
      </span>
    )
  return (
    <span
      data-session-mark={running ? 'running' : unread ? 'unread' : undefined}
      className="flex w-3.5 shrink-0 items-center justify-center"
    >
      {running ? <Spinner size={12} className="text-active!" /> : unread && <Dot tone="accent" size={7} />}
    </span>
  )
}

const TAG_LABEL = {
  waiting: 'sidebar.tree.tag.waiting',
  failed: 'sidebar.tree.tag.failed',
  paused: 'sidebar.tree.tag.paused',
} as const satisfies Record<NeedsYouLane, Parameters<typeof tr>[0]>
const TAG_TONE: Record<NeedsYouLane, string> = {
  waiting: 'bg-warn/15 text-warn',
  failed: 'bg-danger/12 text-danger',
  paused: 'bg-fg-faint/15 text-fg-muted',
}
