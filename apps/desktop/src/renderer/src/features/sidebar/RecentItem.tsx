import { useI18n } from '@/i18n/I18nProvider'
import { GitPullRequest } from 'lucide-react'
import { Dot } from '@/ui'
import { projects, type RecentItem as Recent, type SessionStatus } from '@/data'
import { SessionRow } from './SessionRow'

/** 最近任务如果同时是某个项目下的会话，就沿用它的状态 */
function statusOf(id: string): SessionStatus {
  for (const p of projects) {
    const s = p.sessions.find(x => x.id === id)
    if (s) return s.status
  }
  return 'idle'
}

const DOT_TONE = { idle: 'muted', running: 'success', unread: 'accent' } as const

/** 最近任务：左边 6px 状态圆点，中间标题，右边时间 */
export function RecentItem({
  item,
  status,
  selected,
  onSelect,
}: {
  item: Recent
  /** 不传时从演示数据里找 */
  status?: SessionStatus
  selected: boolean
  onSelect: (id: string) => void
}) {
  useI18n()
  return (
    <SessionRow
      target={{
        id: item.id,
        title: item.title,
        bottomed: !!item.bottomedAt,
        pinned: !!item.pinnedAt,
        archived: false,
        running: (status ?? statusOf(item.id)) === 'running',
      }}
      selected={selected}
      onSelect={onSelect}
      trailing={<span className="shrink-0 text-meta text-fg-faint">{item.time}</span>}
      className="gap-2.5"
    >
      <span className="flex w-4 shrink-0 justify-center">
        <Dot tone={DOT_TONE[status ?? statusOf(item.id)]} size={6} />
      </span>
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {item.hasPr && <GitPullRequest size={14} strokeWidth={1.5} className="shrink-0 text-success" />}
    </SessionRow>
  )
}
