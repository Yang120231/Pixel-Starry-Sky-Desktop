import { Fragment, useState } from 'react'
import { Ellipsis, EllipsisVertical, GitBranch, PanelLeft, PanelRight } from 'lucide-react'
import { cn, IconButton, Popover, useComingSoon } from '@/ui'
import { isMac } from '@/features/layout/keybindings'
import { TOGGLE_PANEL, TOGGLE_SIDEBAR, withShortcut } from '@/features/layout/shortcuts'
import { useI18n } from '@/i18n/I18nProvider'
import { useCommandPalette } from '@/features/commands/CommandPaletteProvider'
import { MachineMenu } from '@/features/machines/MachineMenu'
import { useNarrowWindow } from '@/features/layout/narrowWindow'
import { useSidebarPrefs, type LayoutAction } from '@/features/appearance/sidebar'
import { addProject, isLive } from '@/features/engine'
import { tr } from '@/i18n/core'
import { LayoutActionButton } from '@/features/layout/LayoutActionButton'
import { ToolbarContext, type ToolbarState } from '@/features/layout/ToolbarContext'
import { paneActions } from '@/features/panes/store'
import { useGitSummary } from '@/features/panel/git/summary'
import { HeaderBranch } from './HeaderBranch'
import type { ActiveWorkspace } from '@/features/editor/target'

interface SessionHeaderProps {
  title: string
  /** 工作台：左边显示当前标签所在的工作区「项目 › 分支」，代替标题（标签栏上已经有标题，docs/ui/workbench-ux-3.md §2.1） */
  workspace?: Pick<ActiveWorkspace, 'name' | 'path' | 'ref'>
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

/** 窗口窄时从顶栏收进「更多工具」的（docs/ui/ui-polish-2026-10-13.md §6） */
const COLLAPSIBLE: readonly LayoutAction[] = ['git', 'openIn']
const PAGES: readonly LayoutAction[] = ['workbench', 'channels']

/** 顶栏这一排：工作台、协作频道挨着时包成一个两段切换 */
function groupHeader(actions: LayoutAction[]): LayoutAction[][] {
  const out: LayoutAction[][] = []
  for (const action of actions) {
    const last = out.at(-1)
    if (last?.length === 1 && PAGES.includes(last[0]) && PAGES.includes(action)) last.push(action)
    else out.push([action])
  }
  return out
}

/** 跨会话区和右面板的顶栏：标题在左，工具在右侧连续排列。
 *  机器切换和右面板开关固定，中间工具的顺序和去留由图标位置设置决定（docs/ui/sidebar-compact-controls.md）。 */
export function SessionHeader({
  title,
  workspace,
  showActions,
  sidebarOpen,
  panelOpen,
  onToggleSidebar,
  onTogglePanel,
  filesPanelOpen,
  onCloseFiles,
  panelToggle,
}: SessionHeaderProps) {
  const { text } = useI18n()
  const commands = useCommandPalette()
  const comingSoon = useComingSoon()
  const { layout } = useSidebarPrefs()
  const narrow = useNarrowWindow()
  const header = narrow ? layout.header.filter(a => !COLLAPSIBLE.includes(a)) : layout.header
  const more = [...(narrow ? layout.header.filter(a => COLLAPSIBLE.includes(a)) : []), ...layout.more]
  const onAddProject = isLive ? () => void addProject() : () => comingSoon(tr('sidebar.Sidebar.addProject'))
  const onNewTask = isLive ? () => paneActions.open(null) : undefined
  const callbacks = { onAddProject, onNewTask }
  return (
    <header
      // macOS 侧边栏收起时左上角是红绿灯（index.ts 的 trafficLightPosition），让开
      className={cn(
        'session-header drag @container flex h-12 shrink-0 items-center gap-2',
        isMac && !sidebarOpen ? 'pl-20' : 'pl-4',
      )}
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
        {workspace ? (
          <WorkspaceLocation workspace={workspace} />
        ) : (
          <h1 title={title} className="min-w-0 truncate text-ui font-medium text-fg-secondary">
            {title}
          </h1>
        )}
        {showActions && (
          <IconButton icon={Ellipsis} label={text('更多')} size={32} iconSize={16} onClick={commands.open} />
        )}
      </div>
      <div className="header-tools no-drag ml-auto flex shrink-0 items-center gap-0.5">
        <MachineMenu className={ACTION} />
        <ToolbarContext.Provider value={{ panelOpen, filesPanelOpen, onCloseFiles }}>
          {groupHeader(header).map(group =>
            group.length > 1 ? (
              <div
                key={group.join()}
                role="group"
                aria-label={tr('sidebar.pages')}
                data-header-pages
                className="mx-0.5 inline-flex shrink-0 items-center rounded-lg bg-subtle p-0.5"
              >
                {group.map(action => (
                  <LayoutActionButton key={action} action={action} placement="header" {...callbacks} />
                ))}
              </div>
            ) : (
              <Fragment key={group[0]}>
                <LayoutActionButton action={group[0]} placement="header" {...callbacks} />
              </Fragment>
            ),
          )}
          {more.length > 0 && (
            <MoreTools actions={more} toolbar={{ panelOpen, filesPanelOpen, onCloseFiles }} {...callbacks} />
          )}
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

/** 顶栏「⋮ 更多工具」：图标位置里放进「更多」的，加上窗口窄时收起来的 Git、打开方式；每项一行带文字 */
function MoreTools({
  actions,
  toolbar,
  onAddProject,
  onNewTask,
}: {
  actions: LayoutAction[]
  toolbar: ToolbarState
  onAddProject: () => void
  onNewTask?: () => void
}) {
  useI18n()
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex shrink-0">
      <IconButton
        icon={EllipsisVertical}
        label={tr('sidebar.moreTools')}
        size={32}
        iconSize={16}
        active={open}
        data-more-tools
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={e => open && e.stopPropagation()}
        onClick={() => setOpen(v => !v)}
      />
      <Popover open={open} onClose={() => setOpen(false)} className="top-full right-0 mt-1 w-56">
        <ToolbarContext.Provider value={{ ...toolbar, closeMenu: () => setOpen(false) }}>
          {actions.map(action => (
            <LayoutActionButton
              key={action}
              action={action}
              placement="more"
              onAddProject={onAddProject}
              onNewTask={onNewTask}
            />
          ))}
        </ToolbarContext.Provider>
      </Popover>
    </span>
  )
}

/** 顶栏左边的「项目 › 分支」：不是 Git 仓库、还没读到时只有项目名；分离的 HEAD 显示短 hash。分支名点开能切换（HeaderBranch） */
function WorkspaceLocation({ workspace }: { workspace: NonNullable<SessionHeaderProps['workspace']> }) {
  const git = useGitSummary(workspace.ref)
  const branch = git ? (git.detached ? (git.head ?? '').slice(0, 7) : git.branch) : null
  if (!workspace.name) return null
  return (
    <div data-header-workspace className="flex min-w-0 items-center gap-1.5 text-ui text-fg-secondary">
      <h1 title={workspace.path || workspace.name} className="min-w-0 truncate font-medium">
        {workspace.name}
      </h1>
      {branch &&
        (workspace.ref ? (
          <HeaderBranch workspace={workspace.ref} label={branch} />
        ) : (
          <span className="inline-flex min-w-0 shrink-[2] items-center gap-1 text-fg-muted">
            <GitBranch size={13} strokeWidth={1.5} className="shrink-0" />
            <span className="truncate font-mono text-meta">{branch}</span>
          </span>
        ))}
    </div>
  )
}
