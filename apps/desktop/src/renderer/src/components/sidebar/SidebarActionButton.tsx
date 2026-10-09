import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { IconButton } from '@/components/ui'
import { useSidebarPrefs, type SidebarAction } from '@/appearance/sidebar'
import { getSidebarIcon } from '@/appearance/sidebarIcons'
import { useSettings } from '@/settings/SettingsProvider'
import { OPEN_SETTINGS, withShortcut } from '@/shortcuts'
import { NewTaskButton } from './NewTaskButton'

export interface SidebarActionCallbacks {
  onAddProject: () => void
  /** 演示模式不传入，让新建按钮沿用已有提示。 */
  onNewTask?: () => void
}

/** 顶部、底部共用的动作入口；移动位置不改变行为与设置分类高亮。 */
export function SidebarActionButton({ action, onAddProject, onNewTask }: SidebarActionCallbacks & { action: SidebarAction }) {
  useI18n()
  const { icons } = useSidebarPrefs()
  const settings = useSettings()

  if (action === 'newTask') return <NewTaskButton onClick={onNewTask} />

  const label = action === 'addProject'
    ? tr('sidebar.action.addProject')
    : action === 'settings'
      ? withShortcut(tr('sidebar.SidebarFooter.message408'), OPEN_SETTINGS)
      : action === 'plugins'
        ? tr('plugins.title')
        : tr('nav.TopNav.message60')
  const section = action === 'plugins' || action === 'usage' ? action : undefined
  const active = settings.open && (action === 'settings'
    ? settings.section !== 'plugins' && settings.section !== 'usage'
    : action !== 'addProject' && settings.section === section)

  return (
    <IconButton
      data-sidebar-action={action}
      icon={getSidebarIcon(action, icons)}
      label={label}
      size={32}
      active={active}
      aria-haspopup={action === 'addProject' ? undefined : 'dialog'}
      onClick={action === 'addProject' ? onAddProject : () => settings.openSettings(section)}
    />
  )
}
