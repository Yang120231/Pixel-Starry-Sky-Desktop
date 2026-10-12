// 抽屉（docs/mobile-remote.md §18.3，参考 pi-web）：窄屏从左边拉出来，宽屏常驻左边。从上到下：
// 电脑切换、搜索会话、新建会话（右边是当前项目）、工具按钮、「工作区」（刷新、加项目）和按项目分组的会话，
// 最下面是概览和我的。
import { useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Ellipsis,
  FileCode2,
  Folder,
  FolderPlus,
  GitBranch,
  LayoutList,
  ListChecks,
  Package,
  Plus,
  RefreshCw,
  SquarePen,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import type { ProjectRecord, SessionSummary } from '@pixelsky/protocol'
import { connections } from '@/connection'
import { desktopLists } from '@/data/desktop'
import { useConnections, useContentSearch, useDesktop } from '@/data/hooks'
import { ago, groupTasks, taskTitle } from '@/data/tasks'
import { TOOL_NAMES, type ToolId } from '@/data/tools'
import { PROJECT_STEP, projectGroups, useExpanded, type ProjectGroup } from '@/data/workspace'
import { linkStateText } from '@/i18n/zh'
import { Dot, Spinner, cn } from '@/ui'
import { ContentResults, SearchField } from '@/ui/search'
import { ActionSheet, type SheetAction } from '@/ui/sheet'

const TOOLS: readonly { id: ToolId; icon: LucideIcon }[] = [
  { id: 'git', icon: GitBranch },
  { id: 'files', icon: FileCode2 },
  { id: 'artifacts', icon: Package },
  { id: 'tasks', icon: ListChecks },
]

export interface DrawerProps {
  deviceId: string
  /** 当前打开的页面（高亮用） */
  page: 'home' | 'me' | 'session' | 'other'
  openSession: string | null
  /** 当前项目：「新建会话」和工具按钮作用于它 */
  project: ProjectRecord | null
  onSession(sessionId: string): void
  onNew(projectId: string | null): void
  onTool(tool: ToolId, projectId: string): void
  /** 换当前项目 */
  onProject(projectId: string): void
  onAddProject(): void
  onHome(): void
  onMe(): void
  /** 扫码加电脑（能扫码时才有） */
  onAddComputer(): void
}

export function Drawer(props: DrawerProps) {
  const { deviceId, page, openSession, project, onSession, onNew, onTool, onHome, onMe } = props
  const { link, state, sessions, projects, loaded } = useDesktop(deviceId)
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const ready = state === 'ready'
  const canAct = ready && link?.hello?.access === 'act'
  const tools = ready && !!link?.hello?.tools
  const searching = !!query.trim()
  const content = useContentSearch(deviceId, query, null)
  const groups = projectGroups(sessions, projects, query)
  const waiting = groupTasks(sessions).waiting.length

  const refresh = () => {
    setRefreshing(true)
    void desktopLists.refresh(deviceId).finally(() => setRefreshing(false))
  }

  return (
    <nav aria-label="导航" className="flex h-full min-h-0 flex-col bg-sidebar text-fg">
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-[max(env(safe-area-inset-top),12px)] pb-2">
        <ComputerSwitcher deviceId={deviceId} onAdd={props.onAddComputer} />
        <SearchField value={query} onChange={setQuery} placeholder="搜索会话" className="bg-surface" />
        <button
          type="button"
          disabled={!canAct || !projects.length}
          onClick={() => onNew(project?.id ?? null)}
          className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-ui text-fg active:bg-hover disabled:opacity-40"
        >
          <SquarePen size={18} strokeWidth={1.75} className="shrink-0 text-fg-secondary" />
          <span className="shrink-0">新建会话</span>
          {project && <span className="ml-auto truncate text-meta text-fg-muted">{project.name}</span>}
        </button>
        <div className="grid grid-cols-4 gap-1.5">
          {TOOLS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              disabled={!tools || !project}
              onClick={() => project && onTool(id, project.id)}
              title={tools ? undefined : '电脑上的像素星空版本较旧，更新后才能用'}
              className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl bg-surface text-label text-fg-secondary active:bg-hover disabled:opacity-40"
            >
              <Icon size={19} strokeWidth={1.75} />
              {TOOL_NAMES[id]}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
        {searching && !content.unsupported && (
          <ContentResults
            className="px-3 pt-1 pb-3"
            results={content.results}
            loading={content.loading}
            truncated={content.truncated}
            when={ago}
            onOpen={onSession}
          />
        )}
        <div className="flex items-center gap-1 pt-1 pr-1.5 pl-5">
          <h2 className="flex-1 text-meta font-medium text-fg-muted">{searching ? '标题匹配' : '工作区'}</h2>
          <button
            type="button"
            aria-label="刷新"
            disabled={!ready || refreshing}
            onClick={refresh}
            className="flex size-9 items-center justify-center rounded-full text-fg-muted active:bg-hover disabled:opacity-40"
          >
            <RefreshCw size={16} className={cn(refreshing && 'animate-spin')} />
          </button>
          <button
            type="button"
            aria-label="添加项目"
            disabled={!canAct || !tools}
            onClick={props.onAddProject}
            className="flex size-9 items-center justify-center rounded-full text-fg-muted active:bg-hover disabled:opacity-40"
          >
            <FolderPlus size={17} />
          </button>
        </div>
        {!loaded ? (
          <div className="flex items-center justify-center gap-2 py-10 text-meta text-fg-muted">
            {state && state !== 'ready' ? linkStateText[state] : <Spinner />}
          </div>
        ) : !groups.length ? (
          <p className="px-5 py-6 text-meta text-fg-muted">
            {searching ? '没有匹配的会话' : '电脑上还没有项目，点上面的 + 文件夹添加一个。'}
          </p>
        ) : (
          <ProjectTree
            {...props}
            groups={groups}
            searching={searching}
            canAct={canAct}
            tools={tools}
            openSession={openSession}
          />
        )}
      </div>

      <div className="flex shrink-0 gap-1 border-t border-line-subtle px-2 pt-1.5 pb-[max(env(safe-area-inset-bottom),6px)]">
        <FooterButton icon={LayoutList} label="概览" active={page === 'home'} badge={waiting} onClick={onHome} />
        <FooterButton icon={UserRound} label="我的" active={page === 'me'} onClick={onMe} />
      </div>
    </nav>
  )
}

function FooterButton({
  icon: Icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  badge?: number
  onClick(): void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl text-ui active:bg-hover',
        active ? 'bg-selected font-medium text-fg' : 'text-fg-secondary',
      )}
    >
      <Icon size={18} strokeWidth={1.75} />
      {label}
      {!!badge && (
        <span className="min-w-5 rounded-full bg-danger px-1.5 text-center text-label leading-5 text-accent-on">
          {badge}
        </span>
      )}
    </button>
  )
}

/** 电脑切换：名字、状态；点开列出配对过的电脑和「添加电脑」 */
function ComputerSwitcher({ deviceId, onAdd }: { deviceId: string; onAdd(): void }) {
  const { list } = useConnections()
  const [open, setOpen] = useState(false)
  const active = list.find(p => p.deviceId === deviceId)
  const state = connections.state(deviceId)
  const tone = (s: typeof state) =>
    s === 'ready' ? 'online' : s === 'removed' || s === 'incompatible' ? 'danger' : 'muted'
  return (
    <div className="overflow-hidden rounded-2xl border border-line-subtle bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex min-h-14 w-full items-center gap-3 px-3.5 text-left active:bg-hover"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui font-medium">{active?.desktopName ?? '电脑'}</span>
          <span className="flex items-center gap-1.5 text-meta text-fg-muted">
            <Dot tone={tone(state)} pulse={state === 'connecting' || state === 'handshaking'} />
            <span className="truncate">{state ? linkStateText[state] : ''}</span>
          </span>
        </span>
        <ChevronsUpDown size={17} className="shrink-0 text-fg-faint" />
      </button>
      {open && (
        <div className="border-t border-line-subtle">
          {list.map(p => {
            const s = connections.state(p.deviceId)
            return (
              <button
                key={p.deviceId}
                type="button"
                onClick={() => {
                  connections.select(p.deviceId)
                  setOpen(false)
                }}
                className="flex min-h-12 w-full items-center gap-2.5 px-3.5 text-left active:bg-hover"
              >
                <Dot tone={tone(s)} />
                <span className="min-w-0 flex-1 truncate text-ui">{p.desktopName}</span>
                {p.deviceId === deviceId && <Check size={17} className="shrink-0 text-accent-fg" />}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onAdd()
            }}
            className="flex min-h-12 w-full items-center gap-2.5 border-t border-line-subtle px-3.5 text-left text-ui text-accent-fg active:bg-hover"
          >
            <Plus size={17} className="shrink-0" />
            <span className="min-w-0 flex-1">添加电脑</span>
          </button>
        </div>
      )}
    </div>
  )
}

function ProjectTree({
  deviceId,
  groups,
  searching,
  canAct,
  tools,
  openSession,
  project,
  onSession,
  onNew,
  onTool,
  onProject,
}: DrawerProps & { groups: ProjectGroup[]; searching: boolean; canAct: boolean; tools: boolean }) {
  const { expanded, toggle, only } = useExpanded(deviceId)
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [menu, setMenu] = useState<ProjectGroup | null>(null)
  const menuActions = (g: ProjectGroup): SheetAction[] => [
    { label: '在这个项目里新建会话', disabled: !canAct, onSelect: () => onNew(g.project.id) },
    { label: '设为当前项目', hint: '新建会话和工具按钮用这个项目', onSelect: () => onProject(g.project.id) },
    { label: '收起其他项目', onSelect: () => only(g.project.id) },
    ...TOOLS.map(({ id }) => ({
      label: TOOL_NAMES[id],
      disabled: !tools,
      onSelect: () => onTool(id, g.project.id),
    })),
  ]
  return (
    <div className="flex flex-col px-2">
      {groups.map(g => {
        const id = g.project.id
        // 搜索时全展开；没记过的：当前项目和有会话在等你 / 在跑的展开
        const open = searching || expanded(id, id === project?.id || g.waiting + g.running > 0)
        const limit = limits[id] ?? PROJECT_STEP
        const shown = searching ? g.sessions : g.sessions.slice(0, limit)
        return (
          <div key={id} className="flex flex-col">
            <div className={cn('flex items-center rounded-xl', id === project?.id && 'bg-selected/60')}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(id, !open)}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl pl-2 text-left active:bg-hover"
              >
                {open ? (
                  <ChevronDown size={15} className="shrink-0 text-fg-faint" />
                ) : (
                  <ChevronRight size={15} className="shrink-0 text-fg-faint" />
                )}
                <Folder size={17} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1 truncate text-ui font-medium">{g.project.name}</span>
                {g.waiting > 0 && (
                  <span className="min-w-5 shrink-0 rounded-full bg-danger px-1.5 text-center text-label leading-5 text-accent-on">
                    {g.waiting}
                  </span>
                )}
                {g.running > 0 && !g.waiting && <Dot tone="online" pulse />}
              </button>
              <button
                type="button"
                aria-label={`在「${g.project.name}」里新建会话`}
                disabled={!canAct}
                onClick={() => onNew(id)}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted active:bg-hover disabled:opacity-40"
              >
                <Plus size={17} />
              </button>
              <button
                type="button"
                aria-label={`「${g.project.name}」的更多操作`}
                onClick={() => setMenu(g)}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted active:bg-hover"
              >
                <Ellipsis size={17} />
              </button>
            </div>
            {open && (
              <div className="flex flex-col pb-1.5 pl-6">
                {shown.map(s => (
                  <SessionRow key={s.record.id} s={s} active={s.record.id === openSession} onOpen={onSession} />
                ))}
                {!g.sessions.length && <p className="px-3 py-2 text-meta text-fg-faint">还没有会话</p>}
                {!searching && g.sessions.length > shown.length && (
                  <button
                    type="button"
                    onClick={() => setLimits(l => ({ ...l, [id]: limit + PROJECT_STEP }))}
                    className="min-h-10 rounded-xl px-3 text-left text-meta text-accent-fg active:bg-hover"
                  >
                    显示更多（还有 {g.sessions.length - shown.length} 个）
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
      {menu && <ActionSheet title={menu.project.name} actions={menuActions(menu)} onClose={() => setMenu(null)} />}
    </div>
  )
}

function SessionRow({ s, active, onOpen }: { s: SessionSummary; active: boolean; onOpen(id: string): void }) {
  const running = s.state === 'running' || s.state === 'starting'
  return (
    <button
      type="button"
      onClick={() => onOpen(s.record.id)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-10 items-center gap-2 rounded-xl px-3 text-left active:bg-hover',
        active && 'bg-selected',
      )}
    >
      <span className={cn('min-w-0 flex-1 truncate text-list', s.state === 'waiting' && 'font-medium')}>
        {taskTitle(s)}
      </span>
      {s.state === 'waiting' ? (
        <span className="shrink-0 text-label font-medium text-danger">等你</span>
      ) : running ? (
        <Spinner size={11} className="text-accent-fg" />
      ) : (
        <span className="shrink-0 text-label text-fg-faint">{ago(s.record.updatedAt)}</span>
      )}
    </button>
  )
}
