import { useI18n } from '@/i18n/I18nProvider'
import { Cloud, LayoutDashboard, MessageSquare, Puzzle, type LucideIcon } from 'lucide-react'
import { cn, CountBadge, Dot, IconButton, PopoverItem, useComingSoon } from '@/ui'
import { railItems, type RailItem } from '@/data'
import { setPage, showWorkbench, usePage } from '@/features/layout/page'
import { useChannelUnreadTotal } from '@/features/channels/store'
import type { SidebarPlacement } from '@/features/appearance/sidebar'
import { tr } from '@/i18n/core'
import { useToolbarState } from './ToolbarContext'

const ICONS: Record<RailItem['icon'], LucideIcon> = {
  workbench: LayoutDashboard,
  machines: Cloud,
  channels: MessageSquare,
  skills: Puzzle,
}

/** 云主机 2026-10-13 并进顶栏的机器菜单（docs/ui/ui-polish-2026-10-13.md §6） */
export type NavId = 'workbench' | 'channels'

/** 顶栏上两段切换里的短名字 */
const SHORT_LABEL: Record<NavId, () => string> = {
  workbench: () => tr('sidebar.action.workbench'),
  channels: () => tr('channels.section'),
}

/** 全局导航入口（工作台、协作频道）之一；位置由图标位置设置决定。
 *  顶栏上带文字（两段切换，SessionHeader 把相邻的两个包成一组），侧栏里只有图标，「更多工具」菜单里是一行。
 *  见 docs/ui/design-refresh.md §5.2、docs/ui/sidebar-compact-controls.md、docs/ui/ui-polish-2026-10-13.md §6 */
export function NavButton({ id, placement }: { id: NavId; placement: SidebarPlacement }) {
  const { text } = useI18n()
  const comingSoon = useComingSoon()
  const page = usePage()
  const channelUnread = useChannelUnreadTotal()
  const { closeMenu } = useToolbarState()
  const item = railItems.find(i => i.id === id)
  if (!item) return null
  // 工作台 / 协作频道是两个整页（docs/ui/channels.md §2）
  const active = page === id
  const badge = id === 'channels' ? (channelUnread > 0 ? channelUnread : undefined) : item.badge
  const onClick =
    id === 'workbench' ? showWorkbench : id === 'channels' ? () => setPage('channels') : () => comingSoon(item.label)
  const label = id === 'channels' && badge ? tr('channels.nav.unread', { count: badge }) : text(item.label)
  const Icon = ICONS[item.icon]

  if (placement === 'more')
    return (
      <PopoverItem
        icon={<Icon size={15} strokeWidth={1.5} className="text-fg-secondary" />}
        selected={active}
        hint={badge !== undefined ? String(badge) : undefined}
        onClick={() => {
          closeMenu?.()
          if (!active) onClick()
        }}
      >
        {text(item.label)}
      </PopoverItem>
    )

  if (placement === 'header')
    return (
      <button
        type="button"
        data-nav={id}
        title={label}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        onClick={active ? undefined : onClick}
        className={cn(
          'press no-drag relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-meta',
          active
            ? 'border-line bg-surface font-medium text-fg shadow-sm'
            : 'border-transparent text-fg-muted hover:bg-hover hover:text-fg',
        )}
      >
        <Icon size={15} strokeWidth={1.5} className="shrink-0" />
        <span className="@max-[680px]:hidden">{SHORT_LABEL[id]()}</span>
        {badge !== undefined && <CountBadge count={badge} className="pointer-events-none" />}
        {item.notify && <Dot tone="notify" size={6} className="pointer-events-none" />}
      </button>
    )

  return (
    <span className="relative inline-flex shrink-0">
      <IconButton
        icon={Icon}
        label={label}
        size={32}
        iconSize={16}
        active={active}
        aria-current={active ? 'page' : undefined}
        onClick={active ? undefined : onClick}
      />
      {item.notify && (
        <Dot tone="notify" size={6} className="pointer-events-none absolute top-1 right-1 ring-2 ring-wall-tint" />
      )}
      {badge !== undefined && (
        <CountBadge count={badge} className="pointer-events-none absolute -top-1 -right-1 ring-2 ring-wall-tint" />
      )}
    </span>
  )
}
