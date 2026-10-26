// 会话列表的一行（首页和抽屉共用，docs/mobile-remote.md §21.3、§26）：没有头像，第一行标题和时间，
// 第二行是状态点 + 引擎 · 项目 · 状态或最后一句回复，一行截断（有状态时引擎 · 项目先被截，状态文字不被挤掉），行间一条缩进的细线。
// 等你处理、正在回复、出错时第二行末尾换成带颜色的状态。只管画，文字由调用方算好。
import { Pin } from 'lucide-react'
import { ENGINES, type EngineId } from '@pixelsky/protocol'
import { Dot, cn } from './index'
import { L } from '@/i18n'

export type SessionTone = 'danger' | 'online' | 'warn'
const TEXT: Record<SessionTone, string> = { danger: 'text-danger', online: 'text-online', warn: 'text-warn' }
// 等你处理用橙色、出错用红色（原型）；sessionStatus 里等你处理是 danger、出错是 warn，所以这里换一下
const DENSE_TONE: Record<SessionTone, SessionTone> = { danger: 'warn', warn: 'danger', online: 'online' }

export function SessionRow({
  engine,
  title,
  time,
  project,
  preview,
  status,
  pinned,
  active,
  onClick,
}: {
  engine: EngineId
  title: string
  time: string
  /** 项目名；只有一个项目或已按项目筛过时不传 */
  project?: string
  /** 最后一句回复 */
  preview?: string | null
  /** 不是空闲时的状态：前面的点和第二行的文字 */
  status?: { tone: SessionTone; text: string; pulse?: boolean } | null
  pinned?: boolean
  /** 正打开着（高亮） */
  active?: boolean
  onClick(): void
}) {
  const second = status ? status.text : preview
  const tone = status && DENSE_TONE[status.tone]
  const head = [ENGINES[engine]?.name, project].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn('block w-full px-5 pt-2.5 text-left active:bg-hover', active && 'bg-subtle')}
    >
      <span className="flex min-w-0 items-baseline gap-2.5">
        <span className="min-w-0 flex-1 truncate text-list font-medium">{title}</span>
        {pinned && <Pin size={12} aria-label={L('已置顶', 'Pinned')} className="shrink-0 self-center text-fg-faint" />}
        <span className="shrink-0 text-label text-fg-faint">{time}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 border-b border-line-subtle pt-0.5 pb-2.5 text-meta text-fg-muted">
        <Dot tone={tone ?? 'muted'} pulse={status?.pulse} />
        {/* 有状态：引擎 · 项目先被截，状态文字留全；只有最后一句回复时：引擎 · 项目最多占六成，回复去截 */}
        <span className={cn('truncate', status ? 'min-w-0' : 'max-w-[60%] shrink-0')}>{head}</span>
        {second && (
          <span className={cn('truncate', status ? 'shrink-0' : 'min-w-0', tone && tone !== 'online' && TEXT[tone])}>
            {head && '· '}
            {second}
          </span>
        )}
      </span>
    </button>
  )
}
