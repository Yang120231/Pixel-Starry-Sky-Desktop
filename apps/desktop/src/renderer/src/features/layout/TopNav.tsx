import { useI18n } from '@/i18n/I18nProvider'
import { Cloud, LayoutDashboard, MessageSquare, Puzzle, type LucideIcon } from 'lucide-react'
import { CountBadge, Dot, IconButton, useComingSoon } from '@/ui'
import { railItems, type RailItem } from '@/data'
import { openMachineManager } from '@/features/machines/store'
import { setPage, showWorkbench, usePage } from '@/features/layout/page'
import { useChannelUnreadTotal } from '@/features/channels/store'
import { tr } from '@/i18n/core'

const ICONS: Record<RailItem['icon'], LucideIcon> = {
  workbench: LayoutDashboard,
  machines: Cloud,
  channels: MessageSquare,
  skills: Puzzle,
}

export type NavId = 'workbench' | 'machines' | 'channels'

/** 全局导航入口（工作台、云主机、协作频道）之一；位置由图标位置设置决定。
 *  见 docs/ui/design-refresh.md §5.2、docs/ui/sidebar-compact-controls.md */
export function NavButton({ id }: { id: NavId }) {
  const { text } = useI18n()
  const comingSoon = useComingSoon()
  const page = usePage()
  const channelUnread = useChannelUnreadTotal()
  const item = railItems.find(i => i.id === id)
  if (!item) return null
  // 工作台 / 协作频道是两个整页（docs/ui/channels.md §2），其余入口打开弹窗或提示即将推出
  const active = (id === 'workbench' && page === 'workbench') || (id === 'channels' && page === 'channels')
  const badge = id === 'channels' ? (channelUnread > 0 ? channelUnread : undefined) : item.badge
  const onClick =
    id === 'workbench'
      ? showWorkbench
      : id === 'channels'
        ? () => setPage('channels')
        : id === 'machines'
          ? openMachineManager
          : () => comingSoon(item.label)
  return (
    <span className="relative inline-flex shrink-0">
      <IconButton
        icon={ICONS[item.icon]}
        label={id === 'channels' && badge ? tr('channels.nav.unread', { count: badge }) : text(item.label)}
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
