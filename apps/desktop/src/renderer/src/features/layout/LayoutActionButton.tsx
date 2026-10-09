import { useI18n } from '@/i18n/I18nProvider'
import { Command, GitBranch, SquareTerminal } from 'lucide-react'
import { IconButton } from '@/ui'
import { NavButton } from '@/features/layout/TopNav'
import { SidebarActionButton, type SidebarActionCallbacks } from '@/features/sidebar/SidebarActionButton'
import { isSidebarAction, type LayoutAction } from '@/features/appearance/sidebarIcons'
import type { SidebarPlacement } from '@/features/appearance/sidebar'
import { EditorButton } from '@/features/editor/EditorButton'
import { useTerminalUi } from '@/features/terminal/TerminalProvider'
import { useCommandPalette } from '@/features/commands/CommandPaletteProvider'
import { getPanelLayout, getPanelScope, openRightTab, useActivePanelTab } from '@/features/panel/workspaceStore'
import { usePage } from '@/features/layout/page'
import { tr } from '@/i18n/core'
import { useToolbarState } from './ToolbarContext'

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
        <SidebarActionButton action={action} onAddProject={onAddProject} onNewTask={onNewTask} />
      ) : action === 'terminal' ? (
        <TerminalButton />
      ) : action === 'editor' ? (
        <EditorAction placement={placement} />
      ) : action === 'commandPalette' ? (
        <CommandPaletteButton placement={placement} />
      ) : action === 'git' ? (
        <GitButton />
      ) : (
        <NavButton id={action} />
      )}
    </span>
  )
}

function TerminalButton() {
  const { text } = useI18n()
  const terminal = useTerminalUi()
  const { panelOpen } = useToolbarState()
  const shown = panelOpen && terminal.open && getPanelLayout(getPanelScope()).active === 'terminal'
  return (
    <IconButton
      icon={SquareTerminal}
      label={text(shown ? '收起终端' : '展开终端')}
      size={32}
      iconSize={16}
      active={shown}
      onClick={() => {
        if (panelOpen && getPanelLayout(getPanelScope()).active === 'terminal') terminal.toggle()
        else if (terminal.open) terminal.reveal()
        else terminal.toggle()
      }}
    />
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

function EditorAction({ placement }: { placement: SidebarPlacement }) {
  const { filesPanelOpen, onCloseFiles } = useToolbarState()
  return <EditorButton filesOpen={filesPanelOpen} onCloseFiles={onCloseFiles} messageAbove={placement === 'bottom'} />
}

function CommandPaletteButton({ placement }: { placement: SidebarPlacement }) {
  const { text } = useI18n()
  const commands = useCommandPalette()
  // 顶栏变窄时让位给标题；侧栏里没有这个限制
  return (
    <IconButton
      icon={Command}
      label={`${text('命令面板')}（Ctrl+Shift+P）`}
      size={32}
      iconSize={16}
      className={placement === 'header' ? '@max-[840px]:hidden' : undefined}
      onClick={commands.open}
    />
  )
}
