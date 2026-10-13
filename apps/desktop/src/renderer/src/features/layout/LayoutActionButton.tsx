import { useI18n } from '@/i18n/I18nProvider'
import { GitBranch } from 'lucide-react'
import { IconButton, PopoverItem } from '@/ui'
import { NavButton } from '@/features/layout/TopNav'
import { SidebarActionButton, type SidebarActionCallbacks } from '@/features/sidebar/SidebarActionButton'
import { isSidebarAction, type LayoutAction } from '@/features/appearance/sidebarIcons'
import type { SidebarPlacement } from '@/features/appearance/sidebar'
import { openRightTab, useActivePanelTab } from '@/features/panel/workspaceStore'
import { usePage } from '@/features/layout/page'
import { tr } from '@/i18n/core'
import { useToolbarState } from './ToolbarContext'
import { OpenInButton } from '@/features/editor/OpenInButton'

/** 图标位置设置里的任一入口；顶栏、侧栏顶部、侧栏底部共用，挪位置不改变行为。 */
export function LayoutActionButton({
  action,
  placement,
  onAddProject,
  onNewTask,
}: SidebarActionCallbacks & { action: LayoutAction; placement: SidebarPlacement }) {
  // display: contents 的外壳只做标记，不影响排版
  return (
    <span data-layout-slot={action} className="contents">
      {isSidebarAction(action) ? (
        <SidebarActionButton
          action={action}
          onAddProject={onAddProject}
          onNewTask={onNewTask}
          row={placement === 'more'}
        />
      ) : action === 'git' ? (
        <GitButton row={placement === 'more'} />
      ) : action === 'openIn' ? (
        <OpenInButton placement={placement} />
      ) : (
        <NavButton id={action} placement={placement} />
      )}
    </span>
  )
}

/** 打开右侧面板的 Git 页；已经在显示时再点收起面板（docs/ui/git-panel.md §1.1）。row：「更多工具」菜单里的一行 */
function GitButton({ row }: { row: boolean }) {
  useI18n()
  const { panelOpen, closeMenu } = useToolbarState()
  const page = usePage()
  const tab = useActivePanelTab()
  const shown = panelOpen && page === 'workbench' && tab === 'git'
  const toggle = (): void => {
    if (shown) window.dispatchEvent(new Event('pixelsky:close-right-workspace'))
    else openRightTab('git')
  }
  if (row)
    return (
      <PopoverItem
        icon={<GitBranch size={15} strokeWidth={1.5} className="text-fg-secondary" />}
        selected={shown}
        onClick={() => {
          closeMenu?.()
          toggle()
        }}
      >
        {tr('sidebar.action.git')}
      </PopoverItem>
    )
  return (
    <IconButton
      icon={GitBranch}
      label={tr(shown ? 'git.toolbar.close' : 'git.toolbar.open')}
      size={32}
      iconSize={16}
      active={shown}
      onClick={toggle}
    />
  )
}
