import { Dot } from '@/ui'
import { StatusDot } from '@/features/session/live/StatusDot'

/**
 * 侧栏会话行右边一直写时间；运行中的橙色圆点（和对话里的状态点同一套，docs/ui/conversation-concise.md §7.1）、
 * 有新回复的主色点在标题左边（SessionLead）。正常和极简模式一样（docs/ui/minimal-mode.md）。
 * 置顶行左边是图钉，点还放右边、不写时间
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
  /** 标题左边有没有放 SessionLead（置顶行左边是图钉，点还放右边） */
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

/** 标题左边的状态点：挂在缩进里（负外边距），有点没点的标题都对齐 */
export function SessionLead({ running, unread }: { running: boolean; unread: boolean }) {
  if (!running && !unread) return null
  return (
    <span data-session-lead className="-ml-6 flex w-3.5 shrink-0 items-center justify-center">
      {running ? <StatusDot status="running" /> : <Dot tone="accent" size={6} />}
    </span>
  )
}
