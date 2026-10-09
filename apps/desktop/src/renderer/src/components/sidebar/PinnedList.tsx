import { useI18n } from '@/i18n/I18nProvider'
import { Pin, SquareKanban } from 'lucide-react'
import { Dot, cn, useComingSoon } from '@/components/ui'
import type { PinnedItem } from '@/data'
import { SidebarRow } from './SidebarSection'

/** 置顶项（演示模式）：任务看板或固定的会话 */
export function PinnedList({
  items,
  selectedSessionId,
  onSelectSession,
}: {
  items: PinnedItem[]
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
}) {
  useI18n()
  const comingSoon = useComingSoon()
  return (
    <>
      {items.map(item =>
        item.kind === 'board' ? (
          <SidebarRow key={item.id} onClick={() => comingSoon(item.title)} title={item.title}>
            <SquareKanban size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
              <span className="shrink-0">{item.title}</span>
              {item.meta && <span className="min-w-0 truncate text-meta text-fg-faint">{item.meta}</span>}
            </span>
            {item.trailing && <span className="shrink-0 text-meta text-fg-muted">{item.trailing}</span>}
          </SidebarRow>
        ) : (
          <SidebarRow
            key={item.id}
            selected={item.id === selectedSessionId}
            onClick={() => onSelectSession(item.id)}
            title={item.title}
          >
            <Pin size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
            <span className={cn('min-w-0 flex-1 truncate', item.unread && 'font-semibold text-fg')}>{item.title}</span>
            {item.unread && <Dot tone="accent" className="mr-0.5" />}
          </SidebarRow>
        ),
      )}
    </>
  )
}
