import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { IconButton, useComingSoon } from '@/ui'
import { useSidebarPrefs } from '@/features/appearance/sidebar'
import { getSidebarIcon } from '@/features/appearance/sidebarIcons'

/** 紧凑操作栏里的新建图标，使用本机外观偏好。 */
export function NewTaskButton({ onClick }: { onClick?: () => void }) {
  useI18n()
  const comingSoon = useComingSoon()
  const prefs = useSidebarPrefs()
  return (
    <IconButton
      data-sidebar-action="newTask"
      icon={getSidebarIcon('newTask', prefs.icons)}
      label={tr('sidebar.action.newTask')}
      size={32}
      onClick={onClick ?? (() => comingSoon(tr('sidebar.NewTaskButton.newTask')))}
    />
  )
}
