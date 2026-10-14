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
 * 项目里对话的状态（docs/ui/sidebar-styles.md「大文件夹」版）：挂在项目文件夹图标正下方（行左边 5px 起、14px 宽，绝对定位，不占标题的位置）。
 * 转圈 = 在跑；黄 / 红 / 灰点 = 等你 / 出错 / 暂停（右边的时间换成 NeedsYouLabel）；主色点 = 有新回复
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
  const kind = needsYou(lane) ? lane : running ? 'running' : unread ? 'unread' : undefined
  if (!kind) return null
  return (
    <span data-session-mark={kind} className="absolute left-[5px] flex w-3.5 items-center justify-center">
      {kind === 'running' ? (
        <Spinner size={11} className="text-active!" />
      ) : kind === 'unread' ? (
        <Dot tone="accent" size={7} />
      ) : (
        <span className={cn('size-[7px] rounded-full', DOT_TONE[kind])} />
      )}
    </span>
  )
}

/** 要你处理的对话右边写「等你 / 出错 / 暂停」，代替时间 */
export function NeedsYouLabel({ lane }: { lane: NeedsYouLane }) {
  return <span className={cn('shrink-0 text-meta font-semibold', TEXT_TONE[lane])}>{tr(TAG_LABEL[lane])}</span>
}

const TAG_LABEL = {
  waiting: 'sidebar.tree.tag.waiting',
  failed: 'sidebar.tree.tag.failed',
  paused: 'sidebar.tree.tag.paused',
} as const satisfies Record<NeedsYouLane, Parameters<typeof tr>[0]>
const DOT_TONE: Record<NeedsYouLane, string> = {
  waiting: 'bg-warn',
  failed: 'bg-danger',
  paused: 'bg-fg-faint',
}
const TEXT_TONE: Record<NeedsYouLane, string> = {
  waiting: 'text-warn',
  failed: 'text-danger',
  paused: 'text-fg-muted',
}
