import { Ellipsis, PanelLeft, PanelRight } from 'lucide-react'
import { cn, IconButton, SEGMENT_ICON, SEGMENT_TRACK } from '@/ui'
import { isMac } from '@/features/layout/keybindings'
import { TOGGLE_PANEL, TOGGLE_SIDEBAR, withShortcut } from '@/features/layout/shortcuts'
import { useI18n } from '@/i18n/I18nProvider'
import { useCommandPalette } from '@/features/commands/CommandPaletteProvider'
import { MachineSwitch } from '@/features/machines/MachineSwitch'
import { useSidebarPrefs } from '@/features/appearance/sidebar'
import { useChannelUnreadTotal } from '@/features/channels/store'
import { tr } from '@/i18n/core'
import { LayoutActionButton } from '@/features/layout/LayoutActionButton'
import { ToolbarContext } from '@/features/layout/ToolbarContext'
import type { ActiveWorkspace } from '@/features/editor/target'
import { SessionChannelBadge } from '@/features/channels/SessionChannelBadge'

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
  /** 当前会话：加入了频道时标题旁显示「# 频道 · 成员名」（docs/ui/import-collab.md 第 5 项②） */
  sessionId?: string | null
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
  sessionId,
}: SessionHeaderProps) {
  const { text } = useI18n()
  const commands = useCommandPalette()
  const { layout } = useSidebarPrefs()
  // 侧栏收起时看不到「频道」行的未读，改在「展开侧栏」按钮上显示一个点（docs/ui/layout-v2.md §8）
  const channelUnread = useChannelUnreadTotal()
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
        <span className="relative inline-flex shrink-0">
          <IconButton
            icon={PanelLeft}
            label={[
              withShortcut(text('展开侧边栏'), TOGGLE_SIDEBAR),
              channelUnread > 0 ? tr('sidebar.channelsUnread', { n: channelUnread }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
            size={32}
            iconSize={16}
            onClick={onToggleSidebar}
          />
          {channelUnread > 0 && (
            <span
              data-channel-unread
              className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-accent"
            />
          )}
        </span>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {workspace?.name || title ? (
          // 标题 + 项目名（两种模式一样，docs/ui/layout-v2.md §4）；新对话标签没有标题，只写项目名
          <div data-header-workspace className="flex min-w-0 items-baseline gap-2">
            {/* 有项目时是一行淡色面包屑「项目 › 标题」，标签栏才是主角（docs/ui/session-header-layouts-mockup.html 方案二） */}
            {title && workspace?.name && (
              <>
                <span
                  title={workspace.path || workspace.name}
                  className="max-w-[40%] shrink-0 truncate text-meta text-fg-muted"
                >
                  {workspace.name}
                </span>
                <span aria-hidden className="shrink-0 text-meta text-fg-faint">
                  ›
                </span>
              </>
            )}
            {title && (
              <h1
                title={title}
                className={cn(
                  'min-w-0 truncate',
                  workspace?.name ? 'text-meta text-fg-secondary' : 'text-ui font-semibold text-fg',
                )}
              >
                {title}
              </h1>
            )}
            {workspace?.name &&
              (title ? null : (
                <h1 title={workspace.path || workspace.name} className="min-w-0 truncate text-ui font-semibold text-fg">
                  {workspace.name}
                </h1>
              ))}
            {sessionId && <SessionChannelBadge sessionId={sessionId} />}
          </div>
        ) : null}
        {showActions && (
          // 平时透明，鼠标移到顶栏或键盘焦点到它时显示（globals.css [data-header-more]）
          <span data-header-more className="inline-flex shrink-0">
            <IconButton icon={Ellipsis} label={text('更多')} size={32} iconSize={16} onClick={commands.open} />
          </span>
        )}
      </div>
      <div className="header-tools no-drag ml-auto flex shrink-0 items-center gap-0.5">
        <MachineSwitch />
        {/* 打开方式等工具和右侧面板开关收进一个细边框轨道，和「本机 | 云端」同一套样子（docs/ui/layout-v2.md §4） */}
        {(layout.header.length > 0 || panelToggle !== null) && (
          <div data-header-group className={SEGMENT_TRACK}>
            <ToolbarContext.Provider value={{ panelOpen, filesPanelOpen, onCloseFiles }}>
              {layout.header.map(action => (
                <LayoutActionButton key={action} action={action} placement="header" />
              ))}
            </ToolbarContext.Provider>
            {layout.header.length > 0 && panelToggle !== null && (
              <span aria-hidden className="mx-0.5 h-3.5 w-px shrink-0 bg-line" />
            )}
            {panelToggle === undefined ? (
              <IconButton
                icon={PanelRight}
                label={withShortcut(panelOpen ? text('收起右侧面板') : text('展开右侧面板'), TOGGLE_PANEL)}
                style={SEGMENT_ICON}
                active={panelOpen}
                aria-expanded={panelOpen}
                onClick={onTogglePanel}
              />
            ) : (
              panelToggle && (
                <IconButton
                  icon={PanelRight}
                  label={withShortcut(panelToggle.label, TOGGLE_PANEL)}
                  style={SEGMENT_ICON}
                  active={panelToggle.open}
                  aria-expanded={panelToggle.open}
                  onClick={panelToggle.onToggle}
                />
              )
            )}
          </div>
        )}
      </div>
    </header>
  )
}
