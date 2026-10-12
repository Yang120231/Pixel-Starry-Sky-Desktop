import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useEffect, useId, useRef, useState } from 'react'
import { ChevronUp, SquareKanban } from 'lucide-react'
import { cn, Dot, Spinner } from '@/ui'
import { setPage } from '@/features/layout/page'
import { useSessionCards } from '@/features/board/useSessionCards'
import { laneCounts, type SessionCard, type SessionLane } from '@/features/board/sessionLanes'

const LANE_LABEL: Record<SessionLane, Parameters<typeof tr>[0]> = {
  waiting: 'board.lane.waiting',
  failed: 'board.lane.failed',
  paused: 'board.lane.paused',
  unread: 'board.lane.unread',
  running: 'board.lane.running',
}
const LANE_TONE: Record<SessionLane, string> = {
  waiting: 'text-warn',
  failed: 'text-danger',
  paused: 'text-fg-muted',
  unread: 'text-accent-fg',
  running: 'text-fg-faint',
}

/**
 * 底部「N 运行中 · N 等你」胶囊（docs/ui/task-board.md §2.1）：只管会话，和任务看板的「进行中」AI 卡片、「等你」列同一套分类。
 * 两个都是 0 时不显示。点开在上方列出这些会话（等你的在前、带原因），点一条就打开它；最下面能打开任务看板。
 */
export function RunStatusPill({
  selectedSessionId,
  onSelectSession,
}: {
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
}) {
  useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const listId = useId()
  const items = useSessionCards()
  const { running, waiting } = laneCounts(items)
  const expanded = open && items.length > 0

  useEffect(() => {
    if (!expanded) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [expanded])

  if (!items.length) return null
  const select = (id: string) => {
    setOpen(false)
    onSelectSession(id)
  }
  return (
    <div ref={ref} className="relative shrink-0 px-3 pb-3" data-run-status>
      {expanded && (
        <div
          id={listId}
          role="listbox"
          aria-label={tr('sidebar.runStatus.listBoard')}
          className="pop-in no-drag absolute right-3 bottom-full left-3 z-40 mb-1 flex max-h-80 flex-col gap-px overflow-y-auto rounded-lg border border-line-card bg-popover p-1 shadow-menu [scrollbar-width:thin]"
        >
          {items.map(item => (
            <RunStatusRow key={item.id} item={item} selected={item.id === selectedSessionId} onSelect={select} />
          ))}
          <div role="separator" className="my-1 border-t border-line-subtle" />
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setPage('board')
            }}
            className="flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-ui text-fg-secondary hover:bg-hover hover:text-fg"
          >
            <SquareKanban size={14} strokeWidth={1.5} className="mx-px shrink-0" />
            <span className="flex-1">{tr('sidebar.runStatus.openBoard')}</span>
            <span aria-hidden className="text-fg-faint">
              →
            </span>
          </button>
        </div>
      )}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        title={tr(expanded ? 'sidebar.runStatus.collapse' : 'sidebar.runStatus.expandBoard')}
        onClick={() => setOpen(value => !value)}
        className="press flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 text-list text-fg shadow-sm hover:border-line-strong"
      >
        {running > 0 ? <Spinner size={14} /> : <Dot tone="accent" size={6} className="mx-1" />}
        {/* 数字是 0 的那一半用灰色，不像有事 */}
        <span className={cn('tabular-nums', !running && 'text-fg-faint')}>
          {running}
          {tr('session.live.agentTrace.running')}
        </span>
        <span className="text-fg-faint">·</span>
        <span className={cn('tabular-nums', waiting ? 'text-accent-fg' : 'text-fg-faint')}>
          {waiting}
          {tr('sidebar.runStatus.waiting')}
        </span>
        <span className="flex-1" />
        <ChevronUp
          size={16}
          strokeWidth={1.5}
          className={cn('shrink-0 text-fg-muted transition-transform', expanded && 'rotate-180')}
        />
      </button>
    </div>
  )
}

function RunStatusRow({
  item,
  selected,
  onSelect,
}: {
  item: SessionCard
  selected: boolean
  onSelect: (id: string) => void
}) {
  const label = tr(LANE_LABEL[item.lane])
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      title={[item.title, item.project, label].filter(Boolean).join(' · ')}
      onClick={() => onSelect(item.id)}
      className={cn(
        'flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-ui text-fg hover:bg-hover',
        selected && 'bg-selected hover:bg-selected',
      )}
    >
      <span className="flex w-4 shrink-0 justify-center">
        {item.lane === 'running' ? <Spinner size={12} /> : <Dot tone="accent" size={6} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      <span className={cn('shrink-0 text-meta', LANE_TONE[item.lane])}>{label}</span>
    </button>
  )
}
