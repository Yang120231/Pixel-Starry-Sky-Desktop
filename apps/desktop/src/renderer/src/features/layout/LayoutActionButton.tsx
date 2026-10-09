import { useI18n } from '@/i18n/I18nProvider'
import { GitBranch } from 'lucide-react'
import { IconButton } from '@/ui'
import { NavButton } from '@/features/layout/TopNav'
import { SidebarActionButton, type SidebarActionCallbacks } from '@/features/sidebar/SidebarActionButton'
import { isSidebarAction, type LayoutAction } from '@/features/appearance/sidebarIcons'
import type { SidebarPlacement } from '@/features/appearance/sidebar'
import { openRightTab, useActivePanelTab } from '@/features/panel/workspaceStore'
import { usePage } from '@/features/layout/page'
import { tr } from '@/i18n/core'
import { useToolbarState } from './ToolbarContext'

/** 图标位置设置里的任一入口；顶栏、侧栏顶部、侧栏底部共用，挪位置不改变行为。 */
export function LayoutActionButton({
  action,
  onAddProject,
  onNewTask,
}: SidebarActionCallbacks & { action: LayoutAction; placement: SidebarPlacement }) {
  // display: contents 的外壳只做标记，不影响排版
  return (
    <span data-layout-slot={action} className="contents">
      {isSidebarAction(action) ? (
        <SidebarActionButton action={action} onAddProject={onAddProject} onNewTask={onNewTask} />
      ) : action === 'git' ? (
        <GitButton />
      ) : (
        <NavButton id={action} />
      )}
    </span>
  )
}

/** 打开右侧面板的 Git 页；已经在显示时再点收起面板（docs/ui/git-panel.md §1.1） */
function GitButton() {
  useI18n()
  const { panelOpen } = useToolbarState()
  const page = usePage()
  const tab = useActivePanelTab()
  const shown = panelOpen && page === 'workbench' && tab === 'git'
  return (
    <IconButton
      icon={GitBranch}
      label={tr(shown ? 'git.toolbar.close' : 'git.toolbar.open')}
      size={32}
      iconSize={16}
      active={shown}
      onClick={() => {
        if (shown) window.dispatchEvent(new Event('pixelsky:close-right-workspace'))
        else openRightTab('git')
      }}
    />
  )
}
