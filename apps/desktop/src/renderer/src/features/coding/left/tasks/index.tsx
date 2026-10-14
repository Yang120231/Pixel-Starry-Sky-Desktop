import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  CircleX,
  Copy,
  Crosshair,
  Hammer,
  ListChecks,
  Package,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Square,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Button, IconButton, Spinner, cn, useToast } from '@/ui'
import { ActionMenu, type MenuAction } from '@/ui/ActionMenu'
import { isDemo } from '@/data'
import { appendComposerDraft } from '@/features/engine/drafts'
import { composerTarget, focusComposer } from '@/features/session/composerTarget'
import { openFile } from '@/features/files/store'
import type { RunTask, RunTaskGroup, RunTaskKind } from '../../../../../../shared/types/project-tools'
import { PanelHeader } from '../../shell/PanelHeader'
import { codingLayout } from '../../layoutStore'
import { useCodingWorkspace } from '../../workspace'
import { filterGroups, isCollapsed, taskCommand, taskKey, visibleRows, type TaskStatus } from '../../tasks/model'
import { loadTasks, TASKS_STALE_MS, useRunTasks, useTaskRunner, useTaskStatuses } from '../../tasks/store'

const GROUP_ICON: Record<RunTaskKind, LucideIcon> = { npm: Package, make: Hammer, cargo: Box }
const COLLAPSED_KEY = 'pixelsky.coding.tasks.collapsed'

type Overrides = Record<string, boolean>
/** 展开 / 收起状态：按项目记在 localStorage，值是 { 文件路径: 是否收起 } */
function readCollapsed(project: string): Overrides {
  try {
    const all = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}') as Record<string, Overrides>
    const mine = all[project]
    return mine && typeof mine === 'object' ? mine : {}
  } catch {
    return {}
  }
}
function writeCollapsed(project: string, value: Overrides): void {
  try {
    const all = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}') as Record<string, Overrides>
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify({ ...all, [project]: value }))
  } catch {
    // 存不了就只在这次有效
  }
}

const clipboardWrite = (text: string): Promise<unknown> =>
  isDemo ? navigator.clipboard.writeText(text) : window.pixelsky!.terminal.clipboardWrite(text)

const baseName = (path: string): string => path.split('/').pop() ?? path

/** 组头的灰字：包管理器、「根目录」或文件名 */
function groupHint(group: RunTaskGroup): string {
  const parts: string[] = []
  if (group.dir) parts.push(baseName(group.file))
  if (group.manager) parts.push(group.manager)
  if (!group.dir) parts.push(tr('coding.tasks.rootDir'))
  return parts.join(' · ')
}

function StatusIcon({ status }: { status: TaskStatus }) {
  const cls = 'shrink-0'
  switch (status.kind) {
    case 'running':
      return <Spinner size={14} className={cn(cls, 'text-accent')} />
    case 'ok':
      return (
        <Check
          size={14}
          strokeWidth={2}
          className={cn(cls, 'text-success')}
          aria-label={tr('coding.tasks.status.ok')}
        />
      )
    case 'failed':
      return (
        <CircleX
          size={14}
          strokeWidth={1.75}
          className={cn(cls, 'text-danger')}
          aria-label={tr('coding.tasks.status.failed')}
        />
      )
    case 'stopped':
      return (
        <Square
          size={12}
          strokeWidth={1.75}
          className={cn(cls, 'text-fg-faint')}
          aria-label={tr('coding.tasks.status.stopped')}
        />
      )
    default:
      return <Play size={12} strokeWidth={1.5} className={cn(cls, 'text-fg-faint')} aria-hidden />
  }
}

interface MenuState {
  x: number
  y: number
  group: RunTaskGroup
  task: RunTask
}

/** 左栏「任务」：按文件分组列出 package.json / Makefile / Cargo.toml 里能跑的命令（docs/ui/coding-tasks.md §4） */
export function TasksView({ visible }: { visible: boolean }) {
  useI18n()
  const toast = useToast()
  const { ref, key: workspaceKey } = useCodingWorkspace()
  const entry = useRunTasks(ref)
  const { state } = entry
  const statuses = useTaskStatuses(state)
  const runner = useTaskRunner(state)
  const [query, setQuery] = useState('')
  const [overrides, setOverrides] = useState<Overrides>({})
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const refKey = ref ? JSON.stringify(ref) : ''
  const project = state?.root ?? workspaceKey

  // 第一次打开、视图重新显示（离上次超过 10 秒）时读
  useEffect(() => {
    if (visible && ref) void loadTasks(ref, TASKS_STALE_MS)
    // ref 只在 refKey 变化时才会变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, refKey])
  useEffect(() => setOverrides(readCollapsed(project)), [project])

  const filtering = query.trim() !== ''
  const groups = useMemo(() => filterGroups(state?.groups ?? [], query), [state, query])
  const rows = useMemo(() => visibleRows(groups, overrides, filtering), [groups, overrides, filtering])
  const rowKey = (row: (typeof rows)[number]): string =>
    row.type === 'group' ? `g:${row.group.file}` : `t:${taskKey(row.group, row.task)}`

  const setCollapsed = (next: Overrides): void => {
    setOverrides(next)
    writeCollapsed(project, next)
  }
  const toggle = (group: RunTaskGroup, collapsed = !isCollapsed(group, overrides)): void =>
    setCollapsed({ ...overrides, [group.file]: collapsed })
  const collapseAll = (): void =>
    setCollapsed(Object.fromEntries((state?.groups ?? []).map(g => [g.file, true] as const)))

  const refresh = (): void => {
    if (ref) void loadTasks(ref)
  }

  const askAi = (group: RunTaskGroup, task: RunTask): void => {
    const target = composerTarget()
    if (!target) {
      toast(tr('coding.tasks.noChat'))
      return
    }
    appendComposerDraft(target.key, tr('coding.tasks.askAiPrompt', { command: taskCommand(group, task) }))
    codingLayout.showRight('chat')
    focusComposer(target.key)
  }
  const saveService = (group: RunTaskGroup, task: RunTask): void => {
    const name = group.dir ? `${task.name} (${group.dir})` : task.name
    if (isDemo || !ref || !state) {
      toast(tr('coding.tasks.serviceSaved', { name }))
      return
    }
    window
      .pixelsky!.projectTools.saveService(ref, { name, command: taskCommand(group, task), cwd: state.root })
      .then(() => toast(tr('coding.tasks.serviceSaved', { name })))
      .catch((e: Error) => toast(e.message))
  }
  const locate = (group: RunTaskGroup, task: RunTask): void => {
    if (ref) void openFile(ref, group.file, task.line ?? 1, 1, undefined, { target: 'code' })
  }
  const actions = (m: MenuState): MenuAction[] => [
    { label: tr('coding.tasks.menu.run'), icon: Play, run: () => void runner.run(m.group, m.task) },
    { label: tr('coding.tasks.menu.runNew'), icon: SquareTerminal, run: () => void runner.run(m.group, m.task, true) },
    { label: tr('coding.tasks.menu.askAi'), icon: Sparkles, run: () => askAi(m.group, m.task) },
    {
      label: tr('coding.tasks.menu.service'),
      icon: Server,
      separator: true,
      run: () => saveService(m.group, m.task),
    },
    {
      label: tr('coding.tasks.menu.copy'),
      icon: Copy,
      run: () => void clipboardWrite(taskCommand(m.group, m.task)).then(() => toast(tr('coding.tasks.copied'))),
    },
    {
      label: tr('coding.tasks.menu.locate', { file: baseName(m.group.file) }),
      icon: Crosshair,
      run: () => locate(m.group, m.task),
    },
  ]

  const focusRow = useCallback((key: string): void => {
    setCursor(key)
    list.current?.querySelector<HTMLElement>(`[data-task-row="${CSS.escape(key)}"]`)?.focus()
  }, [])
  const onKeyDown = (e: KeyboardEvent): void => {
    const index = rows.findIndex(r => rowKey(r) === cursor)
    const row = rows[index]
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next =
        rows[Math.max(0, Math.min(rows.length - 1, (index < 0 ? -1 : index) + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) focusRow(rowKey(next))
    } else if (e.key === 'Enter' && row && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (row.type === 'task') void runner.run(row.group, row.task)
      else toggle(row.group)
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && row?.type === 'group' && !filtering) {
      e.preventDefault()
      toggle(row.group, e.key === 'ArrowLeft')
    }
  }

  const hasGroups = (state?.groups.length ?? 0) > 0
  return (
    <div data-coding-tasks className="flex h-full min-h-0 min-w-0 flex-col">
      <PanelHeader
        title={tr('coding.tasks.title')}
        actions={
          <>
            <IconButton
              icon={ChevronsDownUp}
              label={tr('coding.tasks.collapseAll')}
              size={24}
              iconSize={14}
              disabled={!hasGroups}
              onClick={collapseAll}
            />
            <IconButton
              icon={RefreshCw}
              label={tr('coding.tasks.refresh')}
              size={24}
              iconSize={14}
              disabled={!ref}
              className={entry.loading ? '[&_svg]:animate-spin' : undefined}
              onClick={refresh}
            />
          </>
        }
      />
      <label className="mx-2 mb-2 flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line bg-subtle px-2">
        <Search size={14} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
        <input
          value={query}
          aria-label={tr('coding.tasks.filter')}
          placeholder={tr('coding.tasks.filter')}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' && query) {
              e.preventDefault()
              setQuery('')
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-meta text-fg outline-none"
        />
      </label>
      {!state && entry.error ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-ui font-medium text-fg-secondary">{tr('coding.tasks.error.title')}</p>
          <p className="max-w-full text-meta break-words text-fg-faint">{entry.error}</p>
          <Button onClick={refresh}>{tr('coding.tasks.error.retry')}</Button>
        </div>
      ) : !state ? (
        <div className="flex items-center gap-2 px-4 py-2 text-meta text-fg-faint">
          {ref && <Spinner size={12} />}
          <span>{tr('coding.tasks.loading')}</span>
        </div>
      ) : !hasGroups ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <ListChecks size={20} strokeWidth={1.5} className="text-fg-muted" />
          <p className="text-ui font-medium text-fg-secondary">{tr('coding.tasks.empty.title')}</p>
          <p className="text-meta text-fg-faint">{tr('coding.tasks.empty.hint')}</p>
          <Button icon={Plus} onClick={() => codingLayout.showRight('sandbox')}>
            {tr('coding.tasks.empty.add')}
          </Button>
        </div>
      ) : (
        <div
          ref={list}
          role="tree"
          aria-label={tr('coding.tasks.list')}
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        >
          {entry.error && <p className="px-2 pb-1 text-meta text-danger">{entry.error}</p>}
          {state.truncated && <p className="px-2 pb-1 text-meta text-fg-faint">{tr('coding.tasks.truncated')}</p>}
          {filtering && groups.length === 0 && (
            <p className="px-2 py-1 text-meta text-fg-faint">{tr('coding.tasks.noMatch')}</p>
          )}
          {groups.map(group => {
            const collapsed = !filtering && isCollapsed(group, overrides)
            const Icon = GROUP_ICON[group.kind]
            const gKey = `g:${group.file}`
            return (
              <div key={group.file} role="group">
                <div
                  role="treeitem"
                  aria-expanded={!collapsed}
                  tabIndex={cursor === gKey || (cursor === null && group === groups[0]) ? 0 : -1}
                  data-task-row={gKey}
                  onFocus={() => setCursor(gKey)}
                  onClick={() => {
                    setCursor(gKey)
                    if (!filtering) toggle(group)
                  }}
                  className="press flex h-7 cursor-default items-center gap-1.5 rounded-md px-1 text-ui outline-none hover:bg-hover focus-visible:bg-hover"
                >
                  {collapsed ? (
                    <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
                  ) : (
                    <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
                  )}
                  <Icon size={14} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
                  <span className="min-w-0 truncate font-medium text-fg" title={group.file}>
                    {group.dir || group.file}
                  </span>
                  <span className="min-w-0 shrink-[2] truncate text-meta text-fg-faint">{groupHint(group)}</span>
                </div>
                {!collapsed &&
                  group.tasks.map(task => {
                    const status = statuses.of(group, task)
                    const tKey = `t:${taskKey(group, task)}`
                    const running = status.kind === 'running'
                    const command = taskCommand(group, task)
                    return (
                      <div
                        key={task.name}
                        role="treeitem"
                        aria-selected={cursor === tKey}
                        tabIndex={cursor === tKey ? 0 : -1}
                        data-task-row={tKey}
                        data-task-status={status.kind}
                        title={command}
                        onFocus={() => setCursor(tKey)}
                        onClick={() => {
                          setCursor(tKey)
                          runner.focus(group, task)
                        }}
                        onDoubleClick={() => void runner.run(group, task)}
                        onContextMenu={e => {
                          e.preventDefault()
                          setCursor(tKey)
                          setMenu({ x: e.clientX, y: e.clientY, group, task })
                        }}
                        className={cn(
                          'group/task press flex h-7 cursor-default items-center gap-2 rounded-md pr-1 pl-6 text-ui outline-none hover:bg-hover focus-visible:bg-hover',
                          cursor === tKey && 'bg-selected hover:bg-selected',
                        )}
                      >
                        <StatusIcon status={status} />
                        <span className="shrink-0 text-fg">{task.name}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-meta text-fg-faint">{task.detail}</span>
                        {status.kind === 'failed' && status.code !== null && (
                          <span className="shrink-0 text-meta text-fg-faint group-hover/task:hidden">
                            {tr('coding.tasks.exitCode', { code: status.code })}
                          </span>
                        )}
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={tr(running ? 'coding.tasks.stop' : 'coding.tasks.run', { name: task.name })}
                          title={tr(running ? 'coding.tasks.stop' : 'coding.tasks.run', { name: task.name })}
                          onClick={e => {
                            e.stopPropagation()
                            setCursor(tKey)
                            if (running) runner.stop(group, task)
                            else void runner.run(group, task)
                          }}
                          onDoubleClick={e => e.stopPropagation()}
                          className={cn(
                            'press flex size-5 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg',
                            running
                              ? 'text-danger'
                              : 'invisible group-hover/task:visible group-focus-visible/task:visible',
                          )}
                        >
                          {running ? (
                            <Square size={11} strokeWidth={2} fill="currentColor" />
                          ) : (
                            <Play size={12} strokeWidth={1.75} />
                          )}
                        </button>
                      </div>
                    )
                  })}
              </div>
            )
          })}
        </div>
      )}
      {menu && (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          label={tr('coding.tasks.menu')}
          actions={actions(menu)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

/** 工具条「任务」图标上的角标：在跑的任务个数 */
export function useRunningTaskCount(): number {
  const { ref } = useCodingWorkspace()
  return useTaskStatuses(useRunTasks(ref).state).running
}
