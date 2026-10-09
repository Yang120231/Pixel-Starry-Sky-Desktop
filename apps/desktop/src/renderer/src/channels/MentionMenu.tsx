import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { useLayoutEffect, useRef } from 'react'
import { cn } from '@/components/ui'
import type { ChannelMember } from '@/mock/types'
import { agentMeta, MemberAvatar } from './ChannelMessage'

/** 输入框里的 @ 菜单（docs/ui/channels.md §6）；结构和键盘处理照 components/session/CommandMenu.tsx */
export function MentionMenu({
  id,
  members,
  selected,
  onChoose,
}: {
  id: string
  members: readonly ChannelMember[]
  selected: number
  onChoose: (index: number) => void
}) {
  useI18n()
  const listRef = useRef<HTMLDivElement>(null)

  // 只滚动候选列表，避免 scrollIntoView 连带移动时间线
  useLayoutEffect(() => {
    const list = listRef.current,
      option = list?.querySelector<HTMLElement>(`[data-mention-index="${selected}"]`)
    if (!list || !option) return
    const viewport = list.getBoundingClientRect(),
      row = option.getBoundingClientRect()
    if (row.top < viewport.top) list.scrollTop += row.top - viewport.top
    else if (row.bottom > viewport.bottom) list.scrollTop += row.bottom - viewport.bottom
  }, [members, selected])

  return (
    <div className="no-drag absolute right-0 bottom-full left-0 z-30 mb-2 overflow-hidden rounded-lg border border-line-card bg-popover p-1 shadow-menu">
      <div
        ref={listRef}
        id={id}
        role="listbox"
        aria-label={tr('channels.mention.label')}
        className="max-h-64 overflow-y-auto overscroll-contain"
      >
        {members.length === 0 && (
          <div className="px-3 py-2 text-meta text-fg-muted">{tr('channels.mention.empty')}</div>
        )}
        {members.map((member, index) => {
          const meta =
            agentMeta(member) ??
            (member.kind === 'human' && member.role
              ? tr(member.role === 'owner' ? 'channels.role.owner' : 'channels.role.member')
              : '')
          return (
            <button
              type="button"
              role="option"
              tabIndex={-1}
              key={member.id}
              id={`${id}-${index}`}
              data-mention-index={index}
              aria-selected={index === selected}
              onMouseDown={e => e.preventDefault()}
              onClick={() => onChoose(index)}
              className={cn(
                'flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-list',
                index === selected ? 'bg-selected' : 'hover:bg-hover',
              )}
            >
              <MemberAvatar member={member} size={22} />
              <span className="shrink-0 font-medium text-fg">{member.name}</span>
              {meta && <span className="min-w-0 truncate text-meta text-fg-faint">{meta}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
