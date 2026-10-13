import { useI18n } from '@/i18n/I18nProvider'
import { GitBranch } from 'lucide-react'
import { IconButton, SEGMENT_ICON } from '@/ui'
import { SidebarActionButton } from '@/features/sidebar/SidebarActionButton'
import { isFooterAction, type LayoutAction } from '@/features/appearance/sidebarIcons'
import type { SidebarPlacement } from '@/features/appearance/sidebar'
import { openRightTab, useActivePanelTab } from '@/features/panel/workspaceStore'
import { usePage } from '@/features/layout/page'
import { tr } from '@/i18n/core'
import { useToolbarState } from './ToolbarContext'
import { OpenInButton } from '@/features/editor/OpenInButton'

/** 图标位置设置里的任一入口；顶栏、侧栏底部共用（「不显示」不渲染），挪位置不改变行为。
 *  顶栏里放在细边框轨道内，按钮缩成 28×24（docs/ui/layout-v2.md §4）。 */
export function LayoutActionButton({ action, placement }: { action: LayoutAction; placement: SidebarPlacement }) {
  const compact = placement === 'header'
  // display: contents 的外壳只做标记，不影响排版
  return (
    <span data-layout-slot={action} className="contents">
      {isFooterAction(action) ? (
        <SidebarActionButton action={action} compact={compact} />
      ) : action === 'git' ? (
        <GitButton compact={compact} />
      ) : (
        <OpenInButton placement={placement} />
      )}
    </span>
  )
}

/** 打开右侧面板的 Git 页；已经在显示时再点收起面板（docs/ui/git-panel.md §1.1） */
function GitButton({ compact }: { compact: boolean }) {
  useI18n()
  const { panelOpen } = useToolbarState()
  const page = usePage()
  const tab = useActivePanelTab()
  const shown = panelOpen && page === 'workbench' && tab === 'git'
  const toggle = (): void => {
    if (shown) window.dispatchEvent(new Event('pixelsky:close-right-workspace'))
    else openRightTab('git')
  }
  return (
    <IconButton
      icon={GitBranch}
      label={tr(shown ? 'git.toolbar.close' : 'git.toolbar.open')}
      size={32}
      iconSize={16}
      style={compact ? SEGMENT_ICON : undefined}
      active={shown}
      onClick={toggle}
    />
  )
}
