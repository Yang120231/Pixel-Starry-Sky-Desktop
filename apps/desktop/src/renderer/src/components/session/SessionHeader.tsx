import { ChevronDown, Ellipsis, PanelLeft, PanelRight } from 'lucide-react'
import { IconButton, useComingSoon } from '@/components/ui'
import { TOGGLE_PANEL, TOGGLE_SIDEBAR, withShortcut } from '@/shortcuts'
import { useI18n } from '@/i18n/I18nProvider'
import { useCommandPalette } from '@/commands/CommandPaletteProvider'
import { openMachineManager, useMachines } from '@/machines/store'
import { useSidebarPrefs } from '@/appearance/sidebar'
import { addProject, isLive } from '@/engine'
import { tr } from '@/i18n/core'
import { LayoutActionButton } from '@/components/toolbar/LayoutActionButton'
import { ToolbarContext } from '@/components/toolbar/ToolbarContext'
import { paneActions } from '@/panes/store'

interface SessionHeaderProps {
  title: string
  showActions: boolean
  sidebarOpen: boolean
  panelOpen: boolean
  onToggleSidebar: () => void
  onTogglePanel: () => void
  filesPanelOpen?: boolean
  onCloseFiles?: () => void
  /** 替换最右的面板开关（协作频道页控制成员面板）；null 时不显示，不传时是右侧面板开关 */
  panelToggle?: { open: boolean; label: string; onToggle: () => void } | null
}

const ACTION =
  'press no-drag inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-fg-muted hover:bg-hover hover:text-fg'

/** 跨会话区和右面板的顶栏：标题在左，工具在右侧连续排列。
 *  机器切换和右面板开关固定，中间工具的顺序和去留由图标位置设置决定（docs/ui/sidebar-compact-controls.md）。 */
export function SessionHeader({
  title,
  showActions,
  sidebarOpen,
  panelOpen,
  onToggleSidebar,
  onTogglePanel,
  filesPanelOpen,
  onCloseFiles,
  panelToggle,
}: SessionHeaderProps) {
  useI18n()
  const machineState = useMachines(),
    machine = machineState.machines.find(m => m.id === machineState.currentId)
  const { text } = useI18n()
  const commands = useCommandPalette()
  const comingSoon = useComingSoon()
  const { layout } = useSidebarPrefs()
  const onAddProject = isLive ? () => void addProject() : () => comingSoon(tr('sidebar.Sidebar.message396'))
  const onNewTask = isLive ? () => paneActions.open(null) : undefined
  return (
    <header
      className="session-header drag @container flex h-12 shrink-0 items-center gap-2 pl-4"
      style={{ paddingRight: 'calc(var(--titlebar-reserve) + 12px)' }}
    >
      {!sidebarOpen && (
        <IconButton
          icon={PanelLeft}
          label={withShortcut(text('展开侧边栏'), TOGGLE_SIDEBAR)}
          size={32}
          iconSize={16}
          onClick={onToggleSidebar}
        />
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <h1 title={title} className="min-w-0 truncate text-ui font-medium text-fg-secondary">
          {title}
        </h1>
        {showActions && (
          <IconButton icon={Ellipsis} label={text('更多')} size={32} iconSize={16} onClick={commands.open} />
        )}
      </div>
      <div className="header-tools no-drag ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          title={machine?.host ? `${machine.name} · ${machine.username}@${machine.host}` : text('切换机器')}
          aria-label={text('切换机器')}
          onClick={openMachineManager}
          className={ACTION}
        >
          <span
            className={`size-1.5 shrink-0 rounded-full ${machine && ['local', 'connected'].includes(machine.status) ? 'bg-online' : 'bg-warn'}`}
          />
          <span className="max-w-40 truncate text-meta @max-[680px]:hidden">
            {machine?.id === 'local' ? text('本机') : machine?.name}
          </span>
          <ChevronDown size={13} strokeWidth={1.5} />
        </button>
        <ToolbarContext.Provider value={{ panelOpen, filesPanelOpen, onCloseFiles }}>
          {layout.header.map(action => (
            <LayoutActionButton
              key={action}
              action={action}
              placement="header"
              onAddProject={onAddProject}
              onNewTask={onNewTask}
            />
          ))}
        </ToolbarContext.Provider>
        {panelToggle === undefined ? (
          <IconButton
            icon={PanelRight}
            label={withShortcut(panelOpen ? text('收起右侧面板') : text('展开右侧面板'), TOGGLE_PANEL)}
            size={32}
            iconSize={16}
            active={panelOpen}
            aria-expanded={panelOpen}
            onClick={onTogglePanel}
          />
        ) : (
          panelToggle && (
            <IconButton
              icon={PanelRight}
              label={withShortcut(panelToggle.label, TOGGLE_PANEL)}
              size={32}
              iconSize={16}
              active={panelToggle.open}
              aria-expanded={panelToggle.open}
              onClick={panelToggle.onToggle}
            />
          )
        )}
      </div>
    </header>
  )
}
