import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useEffect, useId, useRef, useState } from 'react'
import { ChevronUp } from 'lucide-react'
import { cn, Dot, Spinner } from '@/ui'
import type { RunStatus, RunStatusItem } from '@/features/engine'

/**
 * 底部「N 运行中 / N 新回复」胶囊；status 为 null 时不显示。
 * 点开在上方列出这些会话（运行中在前），点一条就打开它；点外面或按 Esc 收起。
 */
export function RunStatusPill({
  status,
  selectedSessionId,
  onSelectSession,
}: {
  status: RunStatus | null
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
}) {
  useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const listId = useId()
  const items = status?.items ?? []
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

  if (!status) return null
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
          aria-label={tr('sidebar.runStatus.list')}
          className="pop-in no-drag absolute right-3 bottom-full left-3 z-40 mb-1 flex max-h-72 flex-col gap-px overflow-y-auto rounded-lg border border-line-card bg-popover p-1 shadow-menu [scrollbar-width:thin]"
        >
          {items.map(item => (
            <RunStatusRow key={item.id} item={item} selected={item.id === selectedSessionId} onSelect={select} />
          ))}
        </div>
      )}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        title={tr(expanded ? 'sidebar.runStatus.collapse' : 'sidebar.runStatus.expand')}
        onClick={() => setOpen(value => !value)}
        className="press flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 text-list text-fg shadow-sm hover:border-line-strong"
      >
        {status.running > 0 ? <Spinner size={14} /> : <Dot tone="accent" size={6} className="mx-1" />}
        <span className="tabular-nums">
          {status.running}
          {tr('session.live.agentTrace.message193')}{' '}
        </span>
        <span className="text-accent-fg tabular-nums">
          {status.newReplies}
          {tr('sidebar.RunStatusPill.message395')}{' '}
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
  item: RunStatusItem
  selected: boolean
  onSelect: (id: string) => void
}) {
  const label = tr(item.status === 'running' ? 'sidebar.runStatus.running' : 'sidebar.runStatus.unread')
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
      <span className="flex w-4 shrink-0 justify-center" aria-label={label}>
        {item.status === 'running' ? <Spinner size={12} /> : <Dot tone="accent" size={6} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {item.project && <span className="max-w-[40%] shrink-0 truncate text-meta text-fg-faint">{item.project}</span>}
    </button>
  )
}
