import { useEffect, useState } from 'react'
import { tr } from '@/i18n/core'
import {
  CirclePause,
  Clock,
  CloudOff,
  FolderX,
  GitMerge,
  GitMergeConflict,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Hand,
  Hourglass,
  KeyRound,
  MessageCircleQuestionMark,
  RouteOff,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { Dot, Spinner, cn } from '@/ui'
import { StatusDot } from '@/features/session/live/StatusDot'
import { sidebarRemaining } from '@/features/session/live/limitModel'
import type { SessionPr } from '../../../../shared/types/session-status'
import { ciFailed, type LabelTone, type SessionStatus, type StatusKind } from './sessionStatusModel'

/**
 * 侧栏会话行右边一直写时间；项目里的对话状态在标题左边（SessionStatusMark）。正常和极简模式一样（docs/ui/minimal-mode.md）。
 * 置顶行左边是图钉，运行中的橙色圆点（和对话里的状态点同一套，docs/ui/conversation-concise.md §7.1）、新回复的点放右边、不写时间。
 * 左边格子被别的状态占着、又有 PR 时，小 PR 图标放在字 / 时间前面（docs/ui/sidebar-status-icons.md §5）
 */
export function SessionMarks({
  running,
  unread,
  time,
  lead = true,
  status,
  ring,
}: {
  running: boolean
  unread: boolean
  time?: string
  /** 标题左边有没有放 SessionStatusMark（置顶行左边是图钉，点还放右边） */
  lead?: boolean
  status?: SessionStatus
  /** CI 小红点外圈的颜色类（跟行的底色） */
  ring?: string
}) {
  const inline = status?.prInline && status.pr ? <InlinePr pr={status.pr} ring={ring} /> : null
  if (lead)
    return (
      <>
        {inline}
        {time && <span className="shrink-0 text-meta text-fg-faint tabular-nums">{time}</span>}
      </>
    )
  return (
    <>
      {inline}
      {unread && <Dot tone="accent" className="mr-0.5" />}
      {running && <StatusDot status="running" />}
      {!unread && !running && time && <span className="shrink-0 text-meta text-fg-faint">{time}</span>}
    </>
  )
}

/** 小一号的 PR 图标（13px），放在右边字 / 时间前面 */
export function InlinePr({ pr, ring }: { pr: SessionPr; ring?: string }) {
  return (
    <span data-session-pr={pr.state} className="inline-flex shrink-0">
      <StatusGlyph kind={prKindOf(pr)} pr={pr} size={13} ring={ring} />
    </span>
  )
}

const prKindOf = (pr: SessionPr): StatusKind =>
  pr.state === 'open' && pr.conflict && !pr.unknown ? 'pr-conflict' : 'pr'

const ICON: Partial<Record<StatusKind, { icon: LucideIcon; tone: string }>> = {
  approve: { icon: Hand, tone: 'text-warn' },
  question: { icon: MessageCircleQuestionMark, tone: 'text-warn' },
  auth: { icon: KeyRound, tone: 'text-danger' },
  balance: { icon: Wallet, tone: 'text-danger' },
  route: { icon: RouteOff, tone: 'text-danger' },
  busy: { icon: Hourglass, tone: 'text-warn' },
  failed: { icon: TriangleAlert, tone: 'text-danger' },
  folder: { icon: FolderX, tone: 'text-danger' },
  offline: { icon: CloudOff, tone: 'text-warn' },
  paused: { icon: CirclePause, tone: 'text-fg-faint' },
  limit: { icon: Clock, tone: 'text-active' },
  'pr-conflict': { icon: GitMergeConflict, tone: 'text-warn' },
}

/** PR 图标按状态：开着绿、草稿灰、已合并紫、已关闭红；查不到状态（unknown）灰色的开着图标 */
export function prIcon(pr: SessionPr | null): { icon: LucideIcon; tone: string } {
  if (!pr || pr.unknown) return { icon: GitPullRequest, tone: 'text-fg-faint' }
  if (pr.state === 'draft') return { icon: GitPullRequestDraft, tone: 'text-fg-faint' }
  if (pr.state === 'merged') return { icon: GitMerge, tone: 'text-status-working' }
  if (pr.state === 'closed') return { icon: GitPullRequestClosed, tone: 'text-danger' }
  return { icon: GitPullRequest, tone: 'text-success' }
}

/**
 * 一个状态的图形（lucide 图标，strokeWidth 1.5）；转圈 / 主色点保持原样。
 * PR 图标开着且检查没过时右下角加 6px 红点，外圈用行的底色（ring）
 */
export function StatusGlyph({
  kind,
  pr = null,
  size = 15,
  ring = 'ring-sidebar',
}: {
  kind: StatusKind
  pr?: SessionPr | null
  size?: number
  ring?: string
}) {
  if (kind === 'running') return <Spinner size={11} className="text-active!" />
  if (kind === 'unread') return <Dot tone="accent" size={7} />
  const { icon: Icon, tone } = kind === 'pr' || kind === 'pr-conflict' ? prFor(kind, pr) : ICON[kind]!
  return (
    <span className="relative inline-flex shrink-0">
      <Icon size={size} strokeWidth={1.5} className={tone} />
      {(kind === 'pr' || kind === 'pr-conflict') && ciFailed(pr) && (
        <span
          data-ci-fail
          className={cn('absolute -right-px -bottom-px size-1.5 rounded-full bg-danger ring-[1.5px]', ring)}
        />
      )}
    </span>
  )
}

const prFor = (kind: StatusKind, pr: SessionPr | null): { icon: LucideIcon; tone: string } =>
  kind === 'pr-conflict' ? ICON['pr-conflict']! : prIcon(pr)

/**
 * 项目里对话的状态（docs/ui/sidebar-styles.md「大文件夹」版、docs/ui/sidebar-status-icons.md §2）：挂在项目文件夹图标正下方，
 * 外面的 SessionItem 负责绝对定位（行左边 5px 起、14px 宽，不占标题的位置）和悬停卡。一格只放一个：先后见 statusOf
 */
export function SessionStatusMark({ status, ring }: { status: SessionStatus; ring?: string }) {
  const kind = status.mark
  if (!kind) return null
  return (
    <span data-session-mark={kind} className="flex items-center justify-center">
      <StatusGlyph kind={kind} pr={status.pr} ring={ring} />
    </span>
  )
}

const TONE: Record<LabelTone, string> = {
  warn: 'text-warn',
  danger: 'text-danger',
  muted: 'text-fg-muted',
}

/** 要你处理的对话右边写「等你 / 要登录 / 出错…」，代替时间；前面可以带一个 13px 的小图标（置顶行） */
export function StatusLabel({
  status,
  ring,
  icon = false,
}: {
  status: SessionStatus
  ring?: string
  /** 字前面带小图标（置顶行左边是图钉，问题类的图标放右边） */
  icon?: boolean
}) {
  if (!status.label || !status.mark) return null
  const inline = status.prInline && status.pr ? <InlinePr pr={status.pr} ring={ring} /> : null
  return (
    <>
      {inline}
      {icon && <StatusGlyph kind={status.mark} size={13} ring={ring} />}
      {status.mark === 'limit' && status.limitAt ? (
        <LimitRemaining at={status.limitAt} />
      ) : (
        <span className={cn('shrink-0 text-meta font-semibold', TONE[status.label.tone])}>{tr(status.label.key)}</span>
      )}
    </>
  )
}

/** CI 小红点外圈的颜色：跟行的底色（选中 / 悬停 / 平时） */
export const ringOf = (selected: boolean): string =>
  selected ? 'ring-selected' : 'ring-sidebar group-hover/session:ring-hover'

/** 等额度恢复的对话右边的剩余时间（超过 1 小时 1:23，不足 12 分），每 15 秒刷新；悬停卡里写全 */
function LimitRemaining({ at }: { at: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [at])
  return (
    <span data-limit-remaining className="shrink-0 text-meta font-semibold text-active tabular-nums">
      {sidebarRemaining(Math.max(0, at - now))}
    </span>
  )
}
