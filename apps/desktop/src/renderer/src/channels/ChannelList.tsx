import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { useMemo, useState } from 'react'
import { AtSign, Hash, Plus, Search, Users } from 'lucide-react'
import { cn, CountBadge, IconButton, useComingSoon } from '@/components/ui'
import { SidebarEmpty, SidebarSection } from '@/components/sidebar/SidebarSection'
import type { Channel } from '@/data/types'

/** 频道列表（docs/ui/channels.md §4）：搜索、频道行（未读 / @你）、新建频道 */
export function ChannelList({
  channels,
  selectedId,
  onSelect,
}: {
  channels: readonly Channel[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  useI18n()
  const comingSoon = useComingSoon()
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? channels.filter(c => c.name.toLowerCase().includes(q) || c.topic?.toLowerCase().includes(q)) : channels
  }, [channels, query])
  const create = () => comingSoon(tr('channels.new'))
  return (
    <nav
      aria-label={tr('channels.list')}
      className="flex w-[260px] shrink-0 flex-col border-r border-line-subtle @max-[700px]:w-[220px]"
    >
      <div className="shrink-0 px-3 pt-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-fg-muted focus-within:border-accent">
          <Search size={14} strokeWidth={1.5} className="shrink-0" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label={tr('channels.search')}
            placeholder={tr('channels.search')}
            className="min-w-0 flex-1 bg-transparent text-list text-fg outline-none placeholder:text-fg-faint"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">
        <SidebarSection
          title={tr('channels.section')}
          action={<IconButton icon={Plus} label={tr('channels.new')} size={22} iconSize={14} onClick={create} />}
        >
          {shown.length === 0 && <SidebarEmpty>{tr('channels.searchEmpty')}</SidebarEmpty>}
          {shown.map(c => {
            const selected = c.id === selectedId
            const Icon = c.scope === 'team' ? Users : Hash
            const label = [
              c.name,
              c.unread > 0 ? tr('channels.unreadCount', { count: c.unread }) : '',
              c.mentioned ? tr('channels.mentioned') : '',
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <button
                key={c.id}
                type="button"
                aria-current={selected || undefined}
                aria-label={label}
                title={c.topic ? `${c.name}\n${c.topic}` : c.name}
                onClick={() => onSelect(c.id)}
                className={cn(
                  'flex h-8 w-full min-w-0 shrink-0 items-center gap-2 rounded-md px-2.5 text-left text-list transition-colors',
                  selected ? 'bg-selected text-fg' : 'text-fg-secondary hover:bg-hover',
                )}
              >
                <Icon size={14} strokeWidth={1.5} className="shrink-0 text-fg-faint" />
                <span className={cn('min-w-0 flex-1 truncate', c.unread > 0 && 'font-medium text-fg')}>{c.name}</span>
                {c.mentioned && <AtSign size={13} strokeWidth={2} className="shrink-0 text-accent-fg" />}
                {c.unread > 0 && <CountBadge count={c.unread} />}
              </button>
            )
          })}
        </SidebarSection>
      </div>
      <div className="shrink-0 border-t border-line-subtle p-2">
        <button
          type="button"
          onClick={create}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-list text-fg-secondary hover:bg-hover"
        >
          <Plus size={14} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
          <span className="truncate">{tr('channels.new')}</span>
        </button>
      </div>
    </nav>
  )
}
