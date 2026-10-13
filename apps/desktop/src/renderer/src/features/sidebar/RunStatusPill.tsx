import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { SquareKanban } from 'lucide-react'
import { cn, Dot } from '@/ui'
import { StatusDot } from '@/features/session/live/StatusDot'
import { setPage } from '@/features/layout/page'
import { laneCounts, type SessionCard, type SessionLane } from '@/features/board/sessionLanes'
import type { RunFilter } from './runFilter'

export const LANE_LABEL: Record<SessionLane, Parameters<typeof tr>[0]> = {
  waiting: 'board.lane.waiting',
  failed: 'board.lane.failed',
  paused: 'board.lane.paused',
  unread: 'board.lane.unread',
  running: 'board.lane.running',
}
export const LANE_TONE: Record<SessionLane, string> = {
  waiting: 'text-warn',
  failed: 'text-danger',
  paused: 'text-fg-muted',
  unread: 'text-accent-fg',
  running: 'text-fg-faint',
}

/**
 * 底部「N 运行中 · N 等你」胶囊（docs/ui/task-board.md §2.1）：只管会话，和任务看板的「进行中」AI 卡片、「等你」列同一套分类。
 * 两个都是 0 时不显示。点一个数字把上面的置顶和项目筛成这类会话，再点一次取消（参考 Claude Desktop 侧栏按状态筛选）；
 * 右边的图标打开任务看板。
 */
export function RunStatusPill({
  cards,
  filter,
  onFilter,
}: {
  cards: readonly SessionCard[]
  filter: RunFilter | null
  onFilter: (filter: RunFilter | null) => void
}) {
  useI18n()
  if (!cards.length) return null
  const { running, waiting } = laneCounts(cards)
  const half = (kind: RunFilter, count: number) => {
    const on = filter === kind
    return (
      <button
        type="button"
        aria-pressed={on}
        disabled={!count && !on}
        title={tr(
          on
            ? 'sidebar.runStatus.clearFilter'
            : kind === 'running'
              ? 'sidebar.runStatus.filterRunning'
              : 'sidebar.runStatus.filterWaiting',
        )}
        onClick={() => onFilter(on ? null : kind)}
        className={cn(
          'press flex h-8 min-w-0 flex-1 basis-0 items-center justify-center gap-2 rounded-md px-2 text-list tabular-nums hover:bg-hover disabled:pointer-events-none',
          on && 'bg-selected hover:bg-selected',
        )}
      >
        {/* 图标都占 14px 宽，两半的字对得齐 */}
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          {kind === 'running' && running > 0 ? (
            <StatusDot status="running" />
          ) : (
            <Dot tone="accent" size={6} className={cn(!count && 'opacity-40')} />
          )}
        </span>
        {/* 数字是 0 的那一半用灰色，不像有事 */}
        <span
          className={cn(
            'flex min-w-0 items-baseline gap-1',
            !count ? 'text-fg-faint' : kind === 'waiting' ? 'text-accent-fg' : on ? 'text-fg' : 'text-fg-secondary',
          )}
        >
          <span className="shrink-0 font-medium">{count}</span>
          <span className="truncate">
            {tr(kind === 'running' ? 'session.live.agentTrace.running' : 'sidebar.runStatus.waiting')}
          </span>
        </span>
      </button>
    )
  }
  return (
    <div className="shrink-0 px-3 pb-3" data-run-status>
      <div className="flex h-10 items-center gap-0.5 rounded-lg border border-line bg-surface p-1 shadow-sm">
        {half('running', running)}
        <span aria-hidden className="h-4 w-px shrink-0 bg-line" />
        {half('waiting', waiting)}
        {/* 看板入口和两半隔开：两半一样宽、字在各自中间 */}
        <span aria-hidden className="h-4 w-px shrink-0 bg-line" />
        <button
          type="button"
          aria-label={tr('sidebar.runStatus.openBoard')}
          title={tr('sidebar.runStatus.openBoard')}
          onClick={() => setPage('board')}
          className="press flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
        >
          <SquareKanban size={15} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}
