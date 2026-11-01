// 抽屉（docs/mobile-remote.md §18.3、§26，原型 docs/ui/mobile-web-ios-mockup.html）：窄屏从左边拉出来，宽屏常驻左边。从上到下：
// 大标题「像素星空」（回概览）+ 新建会话、「项目 / 最近」切换、电脑卡片、搜索、「等你处理」和「工具」两行，
// 然后是会话列表（项目页按项目分组、可折叠，每组有「+」；最近页是平铺的一列），最下面是「设置」。
// 会话行在触屏上可以左滑置顶 / 归档（SwipeRow）。「工具」打开的面板里是当前项目的工具、换当前项目、加项目和刷新。
import { useState } from 'react'
import {
  Check,
  ChevronRight,
  ChevronsUpDown,
  FileCode2,
  Folder,
  FolderPlus,
  GitBranch,
  Inbox,
  Laptop,
  LayoutGrid,
  ListChecks,
  Package,
  Plus,
  RefreshCw,
  Settings,
  SquarePen,
  type LucideIcon,
} from 'lucide-react'
import { CHAT_PROJECT_ID, type ProjectRecord, type SessionSummary } from '@pixelsky/protocol'
import { connections } from '@/connection'
import { desktopLists } from '@/data/desktop'
import { formatBalance } from '@/data/account'
import { useConnections, useContentSearch, useDesktop, useDesktopAccount } from '@/data/hooks'
import {
  ago,
  filterTasks,
  groupTasks,
  projectGroups,
  projectNameOf,
  sessionList,
  sessionStatus,
  taskTitle,
  type ProjectGroup,
} from '@/data/tasks'
import { TOOL_NAMES, toolError, type ToolId } from '@/data/tools'
import { L } from '@/i18n'
import { linkStateLabel } from '@/i18n/labels'
import { isMac } from '@/platform/keys'
import { Dot, FINE_POINTER, Kbd, Segmented, Spinner, cn, useMedia } from '@/ui'
import { ContentResults, SearchField } from '@/ui/search'
import { SessionRow } from '@/ui/SessionRow'
import { Sheet } from '@/ui/sheet'
import { SwipeRow } from './SwipeRow'

const TOOLS: readonly { id: ToolId; icon: LucideIcon }[] = [
  { id: 'git', icon: GitBranch },
  { id: 'files', icon: FileCode2 },
  { id: 'artifacts', icon: Package },
  { id: 'tasks', icon: ListChecks },
]

/** 「最近」先列几个会话，点「显示更多」再加这么多 */
const DRAWER_STEP = 30
/** 「项目」里每组先列几个，点「显示更多」再加这么多 */
const GROUP_LIMIT = 6
const GROUP_STEP = 20

type Tab = 'projects' | 'recent'

// 抽屉记住：上次在哪一页、哪些项目折起来了（localStorage 不可用时只是记不住）
const TAB_KEY = 'pixelsky.m.drawerTab'
const foldedKey = (deviceId: string) => 'pixelsky.m.drawerFolded:' + deviceId
const load = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 记不住就算了 */
  }
}
const loadFolded = (deviceId: string): Set<string> => {
  try {
    const ids: unknown = JSON.parse(load(foldedKey(deviceId)) ?? '[]')
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/** 加 / 去掉一项，返回新集合 */
const toggled = (set: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

export interface DrawerProps {
  deviceId: string
  /** 当前打开的页面（高亮用） */
  page: 'home' | 'me' | 'session' | 'other'
  openSession: string | null
  /** 当前项目：大标题旁的「新建会话」和工具作用于它 */
  project: ProjectRecord | null
  onSession(sessionId: string): void
  onNew(projectId: string | null): void
  onTool(tool: ToolId, projectId: string): void
  /** 换当前项目 */
  onProject(projectId: string): void
  onAddProject(): void
  onHome(): void
  /** 滑动归档了当前打开的会话：回概览（替换历史，返回手势不回到已归档的会话） */
  onArchived(): void
  /** 打开「设置」 */
  onMe(): void
  /** 逐个处理等你的会话 */
  onTriage(): void
  /** 扫码加电脑（能扫码时才有） */
  onAddComputer(): void
  /** 打开键盘快捷键表（有键盘的设备上才显示入口） */
  onShortcuts(): void
}

export function Drawer(props: DrawerProps) {
  const { deviceId, page, openSession, project, onSession, onNew, onHome, onArchived, onMe, onTriage } = props
  const { link, state, sessions, projects, loaded } = useDesktop(deviceId)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>(() => (load(TAB_KEY) === 'recent' ? 'recent' : 'projects'))
  const [limit, setLimit] = useState(DRAWER_STEP)
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [folded, setFolded] = useState(() => loadFolded(deviceId))
  const [archivedOpen, setArchivedOpen] = useState<ReadonlySet<string>>(new Set())
  /** 左滑开着的那一行（同时只开一行） */
  const [swiped, setSwiped] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const account = useDesktopAccount(deviceId)
  const ready = state === 'ready'
  const canAct = ready && link?.hello?.access === 'act'
  const tools = ready && !!link?.hello?.tools
  const searching = !!query.trim()
  const content = useContentSearch(deviceId, query, null)
  const projectName = (s: SessionSummary) => projectNameOf(projects, s.record.projectId)
  const list = sessionList(filterTasks(sessions, query, null, projectName), searching ? Infinity : limit)
  const rows = [...list.waiting, ...list.rest]
  const waiting = groupTasks(sessions).waiting.length
  // 有键盘鼠标（电脑浏览器、接了键盘的平板）：标出快捷键
  const keys = useMedia(FINE_POINTER)
  const touch = useMedia('(pointer: coarse)')
  const mac = isMac()

  const chooseTab = (t: Tab) => {
    setTab(t)
    save(TAB_KEY, t)
  }
  const fold = (id: string) => {
    const next = toggled(folded, id)
    setFolded(next)
    save(foldedKey(deviceId), JSON.stringify([...next]))
  }
  // 左滑的两个操作：和会话页「⋯」菜单（features/session/SessionMenu.tsx）调同样的通道、问同样的确认
  const pin = (s: SessionSummary) => {
    setSwiped(null)
    setActionError(null)
    void link?.call('engine:setSessionPinned', s.record.id, !s.record.pinnedAt).catch(e => setActionError(toolError(e)))
  }
  const archive = async (s: SessionSummary) => {
    setSwiped(null)
    const running = s.state === 'running' || s.state === 'starting'
    const ask = running
      ? L('这个会话还在运行。停止并归档？', 'This conversation is still running. Stop and archive it?')
      : L(
          '归档这个会话？以后可以在电脑上找回。',
          'Archive this conversation? You can restore it on the computer later.',
        )
    if (!link || !confirm(ask)) return
    setActionError(null)
    const call = (stop: boolean) => link.call('engine:archiveSession', s.record.id, true, stop)
    try {
      try {
        await call(running)
      } catch (e) {
        // 手机上看着没在跑，电脑上其实在启动、在投递队列里的消息：再问一次要不要停止
        if ((e as Error).message !== 'SESSION_RUNNING') throw e
        const again = L(
          '电脑上这个会话还在运行。停止并归档？',
          'This conversation is still running on the computer. Stop and archive it?',
        )
        if (!confirm(again)) return
        await call(true)
      }
      if (s.record.id === openSession) onArchived()
    } catch (e) {
      setActionError(toolError(e))
    }
  }

  const renderRow = (s: SessionSummary, withProject: boolean) => (
    <SwipeRow
      key={s.record.id}
      enabled={canAct && touch && !s.record.archivedAt}
      open={swiped === s.record.id}
      pinned={!!s.record.pinnedAt}
      onOpen={() => setSwiped(s.record.id)}
      onClose={() => setSwiped(null)}
      onPin={() => pin(s)}
      onArchive={() => void archive(s)}
    >
      <SessionRow
        engine={s.record.engine}
        title={taskTitle(s)}
        time={ago(s.record.updatedAt)}
        project={withProject ? projectName(s) : undefined}
        preview={s.record.lastReply}
        status={sessionStatus(s)}
        pinned={!!s.record.pinnedAt && s.state !== 'waiting'}
        active={s.record.id === openSession}
        onClick={() => onSession(s.record.id)}
      />
    </SwipeRow>
  )
  const textButton = 'flex min-h-11 w-full items-center px-5 text-left text-meta active:bg-hover'
  const loading = (
    <div className="flex items-center justify-center gap-2 py-10 text-meta text-fg-muted">
      {state && state !== 'ready' ? linkStateLabel(state) : <Spinner />}
    </div>
  )

  const flat = (
    <>
      {searching && (
        <h2 className="px-5 pt-3 pb-1 text-meta font-medium text-fg-muted">{L('标题匹配', 'Title matches')}</h2>
      )}
      {!loaded ? (
        loading
      ) : !rows.length ? (
        <p className="px-5 py-6 text-meta text-fg-muted">
          {searching
            ? L('没有匹配的会话', 'No matching conversations')
            : projects.length
              ? L('还没有会话', 'No conversations yet')
              : L(
                  '电脑上还没有项目，到「工具」里添加一个。',
                  'No projects on the computer yet. Add one under “Tools & projects”.',
                )}
        </p>
      ) : (
        <>
          {rows.map(s => renderRow(s, true))}
          {!searching && list.more > 0 && (
            <button
              type="button"
              onClick={() => setLimit(n => n + DRAWER_STEP)}
              className={cn(textButton, 'text-accent-fg')}
            >
              {L(`显示更多（还有 ${list.more} 个）`, `Show more (${list.more} more)`)}
            </button>
          )}
        </>
      )}
    </>
  )

  const group = (g: ProjectGroup) => {
    const id = g.project?.id ?? ''
    const open = !folded.has(id)
    const name = g.project?.name ?? L('其他', 'Other')
    const archivedShown = archivedOpen.has(id)
    return (
      <div key={id}>
        <div className="flex items-center justify-between pr-2 pl-5">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => fold(id)}
            className="flex min-h-11 min-w-0 items-center gap-0.5 pt-2 text-list font-semibold text-fg-muted"
          >
            <span className="truncate">{name}</span>
            <ChevronRight size={16} className={cn('shrink-0 transition-transform', open && 'rotate-90')} />
          </button>
          {/* 「对话」组不给新建：新对话页只能在项目里选（选不到「对话」） */}
          {g.project && g.project.id !== CHAT_PROJECT_ID && (
            <button
              type="button"
              disabled={!canAct}
              aria-label={L(`在「${name}」里新建会话`, `New conversation in ${name}`)}
              onClick={() => onNew(g.project!.id)}
              className="flex size-11 shrink-0 items-center justify-center text-fg-muted active:bg-hover disabled:opacity-40"
            >
              <Plus size={20} />
            </button>
          )}
        </div>
        {open && (
          <>
            {!g.sessions.length && !g.archived.length && (
              <p className="px-5 pb-2 text-meta text-fg-faint">{L('还没有会话', 'No conversations yet')}</p>
            )}
            {g.sessions.map(s => renderRow(s, false))}
            {g.more > 0 && (
              <button
                type="button"
                onClick={() => setLimits(m => ({ ...m, [id]: (m[id] ?? GROUP_LIMIT) + GROUP_STEP }))}
                className={cn(textButton, 'text-accent-fg')}
              >
                {L(`显示更多（还有 ${g.more} 个）`, `Show more (${g.more} more)`)}
              </button>
            )}
            {g.archived.length > 0 && (
              <>
                <button
                  type="button"
                  aria-expanded={archivedShown}
                  onClick={() => setArchivedOpen(toggled(archivedOpen, id))}
                  className={cn(textButton, 'justify-between pr-4 text-fg-muted')}
                >
                  {L(`已归档 ${g.archived.length}`, `Archived ${g.archived.length}`)}
                  <ChevronRight size={18} className={cn('transition-transform', archivedShown && 'rotate-90')} />
                </button>
                {archivedShown && g.archived.map(s => renderRow(s, false))}
              </>
            )}
          </>
        )}
      </div>
    )
  }
  const byProject = !loaded ? (
    loading
  ) : (
    <>
      {!projects.length && (
        <p className="px-5 py-3 text-meta text-fg-muted">
          {L('电脑上还没有项目，先添加一个。', 'No projects on the computer yet. Add one first.')}
        </p>
      )}
      {projectGroups(sessions, projects, id => limits[id] ?? GROUP_LIMIT).map(group)}
      <button
        type="button"
        disabled={!canAct || !tools}
        onClick={props.onAddProject}
        className="flex min-h-12 w-full items-center gap-3 px-5 text-left text-list text-fg-muted active:bg-hover disabled:opacity-40"
      >
        <FolderPlus size={22} strokeWidth={1.6} className="shrink-0" />
        {L('添加项目', 'Add project')}
      </button>
    </>
  )

  return (
    <nav
      aria-label={L('导航', 'Navigation')}
      className="flex h-full min-h-0 flex-col bg-workbench text-fg"
      // 点在开着的那行以外的地方：收回左滑
      onPointerDownCapture={e => swiped && !(e.target as Element).closest('[data-swipe-open]') && setSwiped(null)}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 pt-[max(env(safe-area-inset-top),12px)] pr-4 pl-5">
        <button
          type="button"
          aria-label={L('回到概览', 'Back to overview')}
          aria-current={page === 'home' ? 'page' : undefined}
          onClick={onHome}
          className="min-h-11 min-w-0 truncate text-left text-title font-bold tracking-tight"
        >
          {L('像素星空', 'PixelSky')}
        </button>
        <button
          type="button"
          disabled={!canAct || !projects.length}
          aria-label={L('新建会话', 'New conversation')}
          title={keys ? `${L('新建会话', 'New conversation')}  ${mac ? '⌥N' : 'Alt N'}` : undefined}
          onClick={() => onNew(project?.id ?? null)}
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface active:bg-hover disabled:opacity-40"
        >
          <SquarePen size={19} strokeWidth={1.75} />
        </button>
      </div>
      <div className="mx-4 mt-1 mb-2.5 shrink-0">
        <Segmented
          value={tab}
          onChange={chooseTab}
          options={[
            { value: 'projects', label: L('项目', 'Projects') },
            { value: 'recent', label: L('最近', 'Recent') },
          ]}
        />
      </div>
      <div className="mx-4 mb-2.5 shrink-0">
        <ComputerSwitcher deviceId={deviceId} onAdd={props.onAddComputer} />
      </div>
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={L('搜索会话', 'Search conversations')}
        className="mx-4 mb-1.5 shrink-0"
        keyTarget="search"
        hint={keys && <Kbd>{mac ? '⌘K' : 'Ctrl K'}</Kbd>}
      />

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3"
        onScroll={() => swiped && setSwiped(null)}
      >
        {actionError && <p className="px-5 py-2 text-meta text-danger">{actionError}</p>}
        {searching && !content.unsupported && (
          <ContentResults
            className="pt-1 pb-3"
            results={content.results}
            loading={content.loading}
            truncated={content.truncated}
            when={ago}
            onOpen={onSession}
          />
        )}
        {!searching && (
          <>
            {waiting > 0 && (
              <NavRow icon={Inbox} label={L('等你处理', 'Needs you')} badge={waiting} divider onClick={onTriage} />
            )}
            <NavRow
              icon={LayoutGrid}
              label={L('工具', 'Tools')}
              hint={L('Git、文件、产物、任务', 'Git, files, artifacts, tasks')}
              onClick={() => setMore(true)}
            />
          </>
        )}
        {searching || tab === 'recent' ? flat : byProject}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line-subtle px-3 pt-1.5 pb-[max(env(safe-area-inset-bottom),6px)]">
        <button
          type="button"
          onClick={onMe}
          aria-label={account ? L('设置', 'Settings') : undefined}
          aria-current={page === 'me' ? 'page' : undefined}
          className={cn(
            'flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-list active:bg-hover',
            page === 'me' ? 'bg-subtle font-medium text-fg' : 'text-fg-secondary',
          )}
        >
          {account ? (
            <>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-avatar text-ui font-medium text-avatar-fg">
                {[...account.name][0]?.toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate text-ui font-medium text-fg">{account.name}</span>
                <span className="truncate text-meta text-fg-muted">
                  {account.balance === null && account.plan
                    ? account.plan
                    : L('余额 ', 'Balance ') + formatBalance(account.balance, account.currency)}
                </span>
              </span>
              <Settings size={20} strokeWidth={1.6} className="shrink-0" />
            </>
          ) : (
            <>
              <Settings size={22} strokeWidth={1.6} className="shrink-0" />
              {L('设置', 'Settings')}
            </>
          )}
        </button>
        {keys && (
          <button
            type="button"
            onClick={props.onShortcuts}
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-2 text-meta text-fg-muted active:bg-hover"
          >
            <Kbd>?</Kbd> {L('键盘快捷键', 'Keyboard shortcuts')}
          </button>
        )}
      </div>
      {more && <MoreSheet {...props} canAct={canAct} onClose={() => setMore(false)} />}
    </nav>
  )
}

/** 抽屉里的一行入口：图标、名字、右边的数字或淡淡的说明 */
function NavRow({
  icon: Icon,
  label,
  hint,
  badge,
  divider,
  onClick,
}: {
  icon: LucideIcon
  label: string
  hint?: string
  badge?: number
  /** 名字下面画一条缩进的细线（后面还有一行时） */
  divider?: boolean
  onClick(): void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-3 pl-5 text-left text-list active:bg-hover"
    >
      <Icon size={22} strokeWidth={1.6} className="shrink-0 text-fg-secondary" />
      <span
        className={cn('flex min-h-11 min-w-0 flex-1 items-center gap-2 pr-4', divider && 'border-b border-line-subtle')}
      >
        <span className="shrink-0">{label}</span>
        {hint && <span className="min-w-0 truncate text-meta text-fg-faint">{hint}</span>}
        {!!badge && (
          <span className="ml-auto min-w-5 shrink-0 rounded-full bg-notify px-1.5 text-center text-label leading-5 text-accent-on">
            {badge}
          </span>
        )}
      </span>
    </button>
  )
}

/** 「工具」：当前项目的工具、当前项目（点一个换）、加项目、刷新列表 */
function MoreSheet({
  deviceId,
  project,
  canAct,
  onTool,
  onProject,
  onAddProject,
  onClose,
}: DrawerProps & { canAct: boolean; onClose(): void }) {
  const { link, state, projects } = useDesktop(deviceId)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const ready = state === 'ready'
  const tools = ready && !!link?.hello?.tools
  const refresh = () => {
    setRefreshing(true)
    setRefreshError(null)
    void desktopLists
      .refresh(deviceId)
      .catch(e => setRefreshError(L(`刷新失败：${toolError(e)}`, `Refresh failed: ${toolError(e)}`)))
      .finally(() => setRefreshing(false))
  }
  return (
    <Sheet title={L('工具与项目', 'Tools & projects')} onClose={onClose}>
      <div className="flex flex-col gap-5 py-3">
        {project && (
          <section className="flex flex-col">
            <h3 className="px-4 pb-1.5 text-meta font-medium text-fg-muted">
              {L(`「${project.name}」的工具`, `Tools for “${project.name}”`)}
            </h3>
            <div className="mx-3 grid grid-cols-4 gap-1.5">
              {TOOLS.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  disabled={!tools}
                  onClick={() => {
                    onClose()
                    onTool(id, project.id)
                  }}
                  className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-line-subtle bg-surface text-label text-fg-secondary active:bg-hover disabled:opacity-40"
                >
                  <Icon size={20} strokeWidth={1.75} />
                  {TOOL_NAMES[id]}
                </button>
              ))}
            </div>
            {!tools && ready && (
              <p className="px-4 pt-1.5 text-label text-fg-faint">
                {L(
                  '电脑上的像素星空版本较旧，更新后才能用。',
                  'The PixelSky app on your computer is out of date. Update it to use these.',
                )}
              </p>
            )}
          </section>
        )}
        <section className="flex flex-col">
          <h3 className="px-4 pb-1.5 text-meta font-medium text-fg-muted">{L('当前项目', 'Current project')}</h3>
          <div className="mx-3 overflow-hidden rounded-xl border border-line-subtle bg-surface">
            {projects.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={p.id === project?.id}
                onClick={() => onProject(p.id)}
                className={cn(
                  'flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left active:bg-hover',
                  i > 0 && 'border-t border-line-subtle',
                )}
              >
                <Folder size={18} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1 truncate text-ui">{p.name}</span>
                {p.id === project?.id && <Check size={18} className="shrink-0 text-accent-fg" />}
              </button>
            ))}
            <button
              type="button"
              disabled={!canAct || !tools}
              onClick={() => {
                onClose()
                onAddProject()
              }}
              className={cn(
                'flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-ui text-accent-fg active:bg-hover disabled:opacity-40',
                projects.length > 0 && 'border-t border-line-subtle',
              )}
            >
              <FolderPlus size={18} strokeWidth={1.75} className="shrink-0" />
              {L('添加项目', 'Add project')}
            </button>
          </div>
        </section>
        <button
          type="button"
          disabled={!ready || refreshing}
          onClick={refresh}
          className="mx-3 flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line-subtle bg-surface text-ui text-fg-secondary active:bg-hover disabled:opacity-40"
        >
          <RefreshCw size={16} className={cn(refreshing && 'animate-spin')} />
          {L('刷新列表', 'Refresh list')}
        </button>
        {refreshError && <p className="-mt-3 px-4 text-meta text-danger">{refreshError}</p>}
      </div>
    </Sheet>
  )
}

/** 电脑切换：图标、名字、状态；点开列出配对过的电脑和「添加电脑」 */
function ComputerSwitcher({ deviceId, onAdd }: { deviceId: string; onAdd(): void }) {
  const { list } = useConnections()
  const [open, setOpen] = useState(false)
  const active = list.find(p => p.deviceId === deviceId)
  const state = connections.state(deviceId)
  const tone = (s: typeof state) =>
    s === 'ready' ? 'online' : s === 'removed' || s === 'incompatible' ? 'danger' : 'muted'
  return (
    <div className="overflow-hidden rounded-2xl bg-subtle">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex min-h-12 w-full items-center gap-3 px-3.5 text-left active:bg-hover"
      >
        <Laptop size={24} strokeWidth={1.6} className="shrink-0 text-fg-secondary" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-list font-semibold">{active?.desktopName ?? L('电脑', 'Computer')}</span>
          <span className="flex items-center gap-1.5 text-meta text-fg-muted">
            <Dot tone={tone(state)} pulse={state === 'connecting' || state === 'handshaking'} />
            <span className="truncate">{state ? linkStateLabel(state) : ''}</span>
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
            <span className="min-w-0 flex-1">{L('添加电脑', 'Add computer')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
