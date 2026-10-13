import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Dot, IconButton, PopoverItem, useComingSoon } from '@/ui'
import { useFeedbackUnread } from '@/features/feedback/store'
import { useToolbarState } from '@/features/layout/ToolbarContext'
import { useSidebarPrefs, type SidebarAction } from '@/features/appearance/sidebar'
import { getSidebarIcon } from '@/features/appearance/sidebarIcons'
import { useSettings } from '@/features/settings/SettingsProvider'
import { OPEN_SETTINGS, withShortcut } from '@/features/layout/shortcuts'
import { NewTaskButton } from './NewTaskButton'

export interface SidebarActionCallbacks {
  onAddProject: () => void
  /** 演示模式不传入，让新建按钮沿用已有提示。 */
  onNewTask?: () => void
}

/** 顶部、底部共用的动作入口；移动位置不改变行为与设置分类高亮。 */
export function SidebarActionButton({
  action,
  onAddProject,
  onNewTask,
  row = false,
}: SidebarActionCallbacks & { action: SidebarAction; /** 顶栏「更多工具」菜单里的一行 */ row?: boolean }) {
  useI18n()
  const { icons } = useSidebarPrefs()
  const settings = useSettings()
  const { closeMenu } = useToolbarState()
  const comingSoon = useComingSoon()
  // 团队回复了反馈、还没看：设置按钮上一个红点（docs/ui/feedback.md §2.6）
  const unread = useFeedbackUnread()
  const dot = action === 'settings' && unread > 0

  if (action === 'newTask' && !row) return <NewTaskButton onClick={onNewTask} />

  const label =
    action === 'newTask'
      ? tr('sidebar.action.newTask')
      : action === 'addProject'
        ? tr('sidebar.action.addProject')
        : action === 'settings'
          ? withShortcut(tr('sidebar.SidebarFooter.settings'), OPEN_SETTINGS)
          : action === 'plugins'
            ? tr('plugins.title')
            : tr('nav.TopNav.usage')
  const section = action === 'plugins' || action === 'usage' ? action : undefined
  const onClick =
    action === 'addProject'
      ? onAddProject
      : action === 'newTask'
        ? (onNewTask ?? (() => comingSoon(tr('sidebar.NewTaskButton.newTask'))))
        : () => settings.openSettings(section)
  const active =
    settings.open &&
    (action === 'settings'
      ? settings.section !== 'plugins' && settings.section !== 'usage'
      : action !== 'addProject' && action !== 'newTask' && settings.section === section)
  const Icon = getSidebarIcon(action, icons)

  if (row)
    return (
      <PopoverItem
        icon={<Icon size={15} strokeWidth={1.5} className="text-fg-secondary" />}
        selected={active}
        hint={action === 'settings' ? OPEN_SETTINGS.label : undefined}
        onClick={() => {
          closeMenu?.()
          onClick()
        }}
      >
        {tr(`sidebar.action.${action}`)}
        {dot && <Dot tone="notify" size={6} className="ml-2 align-middle" />}
      </PopoverItem>
    )

  const button = (
    <IconButton
      data-sidebar-action={action}
      icon={Icon}
      label={label}
      size={32}
      active={active}
      aria-haspopup={action === 'addProject' ? undefined : 'dialog'}
      onClick={onClick}
    />
  )
  if (action !== 'settings') return button
  return (
    <span className="relative inline-flex shrink-0">
      {button}
      {dot && <Dot tone="notify" size={6} className="pointer-events-none absolute top-1 right-1" />}
    </span>
  )
}
