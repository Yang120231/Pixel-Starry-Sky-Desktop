import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useId, useState } from 'react'
import { ChevronDown, FolderPlus, Search } from 'lucide-react'
import { cn, useComingSoon } from '@/ui'
import { setSidebarPrefs, useSidebarPrefs } from '@/features/appearance/sidebar'
import { OPEN_SEARCH, withShortcut } from '@/features/layout/shortcuts'
import { addProject, isLive, recentSpansProjects, useSidebarData } from '@/features/engine'
import { SidebarHeader } from './SidebarHeader'
import { LayoutActionButton } from '@/features/layout/LayoutActionButton'
import { SidebarEmpty, SidebarRow, SidebarSection } from './SidebarSection'
import { PinnedList } from './PinnedList'
import { PinnedTasks } from './PinnedTasks'
import { TASK_DRAG_TYPE, draggedTask, pinTask } from '@/features/panel/pinnedTasks'
import { ProjectTree } from './ProjectTree'
import { RecentItem } from './RecentItem'
import { RunStatusPill } from './RunStatusPill'
import { SidebarFooter } from './SidebarFooter'
import { useOpenSearch } from '@/features/search/SearchProvider'

export interface SidebarProps {
  selectedSessionId: string | null
  /** null 表示新会话（欢迎页） */
  onSelectSession: (id: string | null) => void
  onCollapse: () => void
}

/**
 * 侧边栏（docs/ui/design-refresh.md §5.1）：
 * 顶部与底部（运行状态、最近任务、设置、账户）固定，中间的项目与置顶分组独立滚动。
 * 宽度由外层 CollapsibleSlot 决定，这里始终撑满。
 */
export function Sidebar({ selectedSessionId, onSelectSession, onCollapse }: SidebarProps) {
  useI18n()
  const comingSoon = useComingSoon()
  const openSearch = useOpenSearch()
  const prefs = useSidebarPrefs()
  const recentId = useId()
  // 演示模式是 mock 数据，否则是引擎里的真实项目和会话
  const { projects, pinned: pinnedSessions, recent } = useSidebarData()
  const onAddProject = isLive ? () => void addProject() : () => comingSoon(tr('sidebar.Sidebar.addProject'))
  const onNewTask = isLive ? () => onSelectSession(null) : undefined
  const compactSearch = prefs.layout.top.length >= 4
  // 把任务清单里的任务拖到侧栏任意位置松开：固定到「固定任务」（docs/ui/files-search-terminal-pins.md §5）
  const [dropping, setDropping] = useState(false)
  const taskDrag = (e: React.DragEvent): boolean => e.dataTransfer.types.includes(TASK_DRAG_TYPE)
  return (
    <aside
      className={cn('flex h-full w-full min-w-0 flex-col bg-sidebar', dropping && 'sidebar-task-drop')}
      onDragOver={e => {
        if (!taskDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!dropping) setDropping(true)
      }}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={e => {
        if (!taskDrag(e)) return
        e.preventDefault()
        setDropping(false)
        const task = draggedTask()
        if (task) void pinTask(task, true).catch(() => undefined)
      }}
    >
      <SidebarHeader onCollapse={onCollapse} />

      <div className="no-drag flex shrink-0 items-center gap-1 px-3 pt-1" data-sidebar-actions>
        <button
          type="button"
          aria-label={tr('sidebar.search')}
          aria-haspopup="dialog"
          title={withShortcut(tr('sidebar.search'), OPEN_SEARCH)}
          onClick={openSearch}
          className={cn(
            'press flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-ui text-fg-muted hover:bg-hover hover:text-fg',
            compactSearch ? 'w-8 shrink-0 justify-center' : 'flex-1',
          )}
        >
          <Search size={16} strokeWidth={1.5} className="shrink-0" />
          {!compactSearch && <span className="truncate">{tr('sidebar.search')}</span>}
        </button>
        {prefs.layout.top.map(action => (
          <LayoutActionButton
            key={action}
            action={action}
            placement="top"
            onAddProject={onAddProject}
            onNewTask={onNewTask}
          />
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-3 pt-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* 置顶：任务看板入口 + 置顶的会话（docs/ui/task-board.md §2） */}
        <SidebarSection title={tr('sidebar.Sidebar.pinned')}>
          <PinnedList
            sessions={pinnedSessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
          />
        </SidebarSection>

        <PinnedTasks dropping={dropping} />

        <SidebarSection title={tr('sidebar.Sidebar.projects')}>
          {projects.length > 0 ? (
            <ProjectTree projects={projects} selectedSessionId={selectedSessionId} onSelectSession={onSelectSession} />
          ) : (
            <>
              <SidebarEmpty>{tr('sidebar.Sidebar.noProjectsYet')}</SidebarEmpty>
              {isLive && (
                <SidebarRow onClick={onAddProject}>
                  <FolderPlus size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
                  <span className="truncate">{tr('sidebar.Sidebar.addProjectFolder')}</span>
                </SidebarRow>
              )}
            </>
          )}
        </SidebarSection>
      </div>

      <RunStatusPill selectedSessionId={selectedSessionId} onSelectSession={onSelectSession} />
      {/* 最近任务来自两个以上项目才显示，否则和上面的项目列表完全重复（docs/ui/conversation-ux-2.md §2.3） */}
      {prefs.showRecent && recentSpansProjects(recent) && (
        <section className="mx-3 flex min-h-0 max-h-[35%] shrink-0 flex-col pb-2" data-sidebar-recent>
          <h3 className="shrink-0">
            <button
              type="button"
              aria-expanded={prefs.recentExpanded}
              aria-controls={recentId}
              title={tr(prefs.recentExpanded ? 'sidebar.recent.collapse' : 'sidebar.recent.expand')}
              onClick={() => setSidebarPrefs({ recentExpanded: !prefs.recentExpanded })}
              className="group flex h-8 w-full items-center gap-2 rounded-md px-2 text-label font-medium text-fg-muted hover:bg-hover hover:text-fg"
            >
              <span className="shrink-0">{tr('sidebar.Sidebar.recentTasks')}</span>
              <span className="h-px min-w-0 flex-1 bg-line-subtle" />
              <ChevronDown
                size={14}
                strokeWidth={1.5}
                className="sidebar-history-chevron shrink-0"
                data-expanded={prefs.recentExpanded}
              />
            </button>
          </h3>
          <div
            id={recentId}
            className="sidebar-history-content min-h-0 overflow-hidden"
            data-expanded={prefs.recentExpanded}
            aria-hidden={!prefs.recentExpanded}
            inert={!prefs.recentExpanded}
          >
            <div className="min-h-0 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex flex-col gap-px">
                {recent.map(r => (
                  <RecentItem
                    key={r.id}
                    item={r}
                    status={r.status}
                    selected={r.id === selectedSessionId}
                    onSelect={onSelectSession}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <SidebarFooter onAddProject={onAddProject} onNewTask={onNewTask} />
    </aside>
  )
}
