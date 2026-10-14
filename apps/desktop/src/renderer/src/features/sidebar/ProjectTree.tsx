import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react'
import { Archive, Boxes, ChevronRight, Ellipsis, Folders, Layers, ListPlus, PencilLine, Ungroup, X } from 'lucide-react'
import { Spinner, cn } from '@/ui'
import { ActionMenu } from '@/ui/ActionMenu'
import type { Project } from '@/data'
import { useSessionCards } from '@/features/board/useSessionCards'
import {
  setProjectGroups,
  setProjectsCollapsed,
  useSidebarPrefs,
  type ProjectGroup,
} from '@/features/appearance/sidebar'
import { lanesOf } from './runFilter'
import { SessionItem } from './SessionItem'
import { ProjectRow } from './ProjectRow'
import { GroupNameDialog } from './GroupNameDialog'
import { SHOWN_SESSIONS, projectColor, projectCounts, projectFolders, visibleSessions } from './projectTreeModel'
import {
  addToGroup,
  arrangeProjects,
  createGroup,
  dissolveGroup,
  groupKey,
  groupOf,
  newGroupId,
  rangeBetween,
  removeFromGroups,
  renameGroup,
} from './projectGroups'

/** 拖项目进出分区时 dataTransfer 里的类型（值是项目 ID 的 JSON 数组） */
const PROJECT_DRAG_TYPE = 'application/x-pixelsky-projects'

/**
 * 项目列表（docs/ui/sidebar-hierarchy.md）：项目行像小标题，展开后对话挂在一条竖线下面；
 * 每个项目先列 5 个对话，其余收进「还有 N 个对话」。收起哪些项目记在侧栏偏好里，重启后还在。
 * 分区（docs/ui/sidebar-groups.md）：几个项目归成一组放在最上面；Ctrl / Shift 点项目多选，右键组成分区，
 * 也能把项目拖进拖出分区。右键项目打开项目菜单
 */
export function ProjectTree({
  projects,
  selectedSessionId,
  onSelectSession,
  filtering = false,
}: {
  projects: Project[]
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
  /** 侧栏按状态筛选时：项目和分区全部展开（不改记住的展开状态）、对话全部列出，右边写原因 */
  filtering?: boolean
}) {
  useI18n()
  const cards = useSessionCards()
  const lanes = useMemo(() => lanesOf(cards), [cards])
  const prefs = useSidebarPrefs()
  const collapsed = new Set(prefs.collapsed ?? [])
  const groups = prefs.groups ?? []
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const [archivedOpen, setArchivedOpen] = useState<Record<string, boolean>>({})
  // Ctrl / Shift 选中的项目（准备组成分区）；Esc 或普通点击清掉
  const [picked, setPicked] = useState<string[]>([])
  const anchor = useRef<string | null>(null)
  const [naming, setNaming] = useState<{ ids: string[] } | { group: ProjectGroup } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [groupMenu, setGroupMenu] = useState<{ group: ProjectGroup; x: number; y: number } | null>(null)

  const entries = arrangeProjects(projects, groups)
  const shownGroups = entries.flatMap(e => (e.kind === 'group' ? [e.group] : []))
  const order = entries.flatMap(e => (e.kind === 'group' ? e.projects.map(p => p.id) : [e.project.id]))
  const pickedNow = picked.filter(id => order.includes(id))

  useEffect(() => {
    if (!pickedNow.length) return
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPicked([])
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [pickedNow.length])

  const save = (next: ProjectGroup[]): void => {
    setProjectGroups(next)
    setPicked([])
  }
  const clickProject = (p: Project, open: boolean, event: MouseEvent<HTMLButtonElement>): void => {
    if (event.ctrlKey || event.metaKey) {
      setPicked(prev => (prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]))
      anchor.current = p.id
      return
    }
    if (event.shiftKey) {
      const range = rangeBetween(order, anchor.current, p.id)
      setPicked(prev => [...new Set([...prev, ...range])])
      return
    }
    anchor.current = p.id
    if (pickedNow.length) setPicked([])
    setProjectsCollapsed([p.id], open)
  }
  /** 项目菜单里的分区操作：右键的是选中的项目之一时对整批，否则只对这一个 */
  const groupActions = (p: Project) => {
    const multi = pickedNow.length > 1 && pickedNow.includes(p.id)
    const ids = multi ? pickedNow : [p.id]
    const count = ids.length
    const current = groupOf(groups, p.id)
    return [
      {
        label: multi ? tr('sidebar.group.createPicked', { count }) : tr('sidebar.group.create'),
        icon: Layers,
        run: () => setNaming({ ids }),
      },
      ...shownGroups
        .filter(g => multi || g.id !== current?.id)
        .map(g => ({
          label: multi
            ? tr('sidebar.group.joinPicked', { count, name: g.name })
            : tr('sidebar.group.join', { name: g.name }),
          icon: ListPlus,
          run: () => save(addToGroup(groups, g.id, ids)),
        })),
      ...(ids.some(id => groupOf(groups, id))
        ? [
            {
              label: multi ? tr('sidebar.group.leavePicked', { count }) : tr('sidebar.group.leave'),
              icon: Ungroup,
              run: () => save(removeFromGroups(groups, ids)),
            },
          ]
        : []),
      ...(multi ? [{ label: tr('sidebar.group.clearPicked'), icon: X, run: () => setPicked([]) }] : []),
    ]
  }
  const dragStart = (p: Project) => (event: DragEvent<HTMLDivElement>) => {
    const ids = pickedNow.includes(p.id) ? pickedNow : [p.id]
    event.dataTransfer.setData(PROJECT_DRAG_TYPE, JSON.stringify(ids))
    event.dataTransfer.effectAllowed = 'move'
  }
  const draggedIds = (event: DragEvent): string[] => {
    try {
      const ids: unknown = JSON.parse(event.dataTransfer.getData(PROJECT_DRAG_TYPE) || '[]')
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
    } catch {
      return []
    }
  }
  /** 拖到分区上：放进去；拖到分区外的项目上：移出分区 */
  const dropZone = (target: string, onDrop: (ids: string[]) => void) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(PROJECT_DRAG_TYPE)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      if (dropTarget !== target) setDropTarget(target)
    },
    onDrop: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(PROJECT_DRAG_TYPE)) return
      event.preventDefault()
      event.stopPropagation()
      setDropTarget(null)
      const ids = draggedIds(event)
      if (ids.length) onDrop(ids)
    },
  })

  const renderProject = (p: Project) => {
    const open = filtering || !collapsed.has(p.id)
    const { running, waiting } = projectCounts(p.sessions, lanes)
    const { shown, hidden } = visibleSessions(p.sessions, {
      all: filtering || !!showAll[p.id],
      selected: selectedSessionId,
      lanes,
    })
    const folders = projectFolders(p).map(f => f.name)
    // 展开且下面有东西的项目是一张浅卡（项目行 + 文件夹行 + 对话），收起的就是一行（docs/ui/sidebar-styles.md 版本 4）
    const card = open && (folders.length > 0 || p.sessions.length > 0 || !!p.archived?.length)
    return (
      <div
        key={p.id}
        data-project-group={p.id}
        data-project-card={card || undefined}
        className={cn(
          'flex flex-col gap-px',
          card && 'my-0.5 rounded-lg bg-fg/[0.035] pb-1 ring-1 ring-line-subtle ring-inset',
        )}
      >
        <ProjectRow
          project={p}
          open={open}
          onToggle={event => clickProject(p, open, event)}
          picked={pickedNow.includes(p.id)}
          groupActions={groupActions(p)}
          onDragStart={dragStart(p)}
          trailing={<ProjectStatus project={p} open={open} running={running} waiting={waiting} />}
        />
        {open && folders.length > 0 && (
          <div
            data-project-folders
            title={tr('sidebar.tree.folders', { names: folders.join(', ') })}
            className="-mt-1 flex h-5 min-w-0 items-center gap-1.5 pr-2 pl-[52px] text-meta text-fg-faint"
          >
            <Folders size={12} strokeWidth={1.5} className="-ml-[18px] shrink-0" />
            <span className="min-w-0 truncate">{folders.join(' · ')}</span>
          </div>
        )}
        {open && (p.sessions.length > 0 || !!p.archived?.length) && (
          <div data-project-sessions className="flex flex-col gap-px pr-0.5 pl-5">
            {shown.map(s => (
              <SessionItem
                key={s.id}
                session={s}
                selected={s.id === selectedSessionId}
                onSelect={onSelectSession}
                lane={lanes.get(s.id)}
                reason={filtering}
              />
            ))}
            {!filtering && (hidden > 0 || (showAll[p.id] && p.sessions.length > SHOWN_SESSIONS)) && (
              <MoreRow
                label={hidden > 0 ? tr('sidebar.tree.more', { count: hidden }) : tr('sidebar.tree.less')}
                open={!hidden}
                onClick={() => setShowAll(state => ({ ...state, [p.id]: !state[p.id] }))}
              />
            )}
            {!!p.archived?.length && (
              <>
                <MoreRow
                  icon
                  label={tr('session.archivedCount', { count: p.archived.length })}
                  open={!!archivedOpen[p.id]}
                  onClick={() => setArchivedOpen(state => ({ ...state, [p.id]: !state[p.id] }))}
                />
                {archivedOpen[p.id] &&
                  p.archived.map(session => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      selected={session.id === selectedSessionId}
                      onSelect={onSelectSession}
                    />
                  ))}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="contents" onDragEnd={() => setDropTarget(null)}>
      {pickedNow.length > 0 && (
        <div
          data-projects-picked={pickedNow.length}
          className="mb-1 flex h-7 shrink-0 items-center gap-1 rounded-md bg-accent-soft pr-1 pl-2.5 text-meta text-accent-fg"
        >
          <span className="min-w-0 flex-1 truncate">{tr('sidebar.group.picked', { count: pickedNow.length })}</span>
          <button
            type="button"
            aria-label={tr('sidebar.group.clearPicked')}
            title={tr('sidebar.group.clearPicked')}
            onClick={() => setPicked([])}
            className="inline-flex size-5 items-center justify-center rounded hover:bg-hover"
          >
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      )}
      {entries.map(entry => {
        if (entry.kind === 'project')
          return (
            <div
              key={entry.project.id}
              className="contents"
              {...dropZone('none', ids => save(removeFromGroups(groups, ids)))}
            >
              {renderProject(entry.project)}
            </div>
          )
        const { group, projects: members } = entry
        const open = filtering || !collapsed.has(groupKey(group.id))
        const totals = members.reduce(
          (sum, p) => {
            const c = projectCounts(p.sessions, lanes)
            return { running: sum.running + c.running, waiting: sum.waiting + c.waiting }
          },
          { running: 0, waiting: 0 },
        )
        return (
          <section
            key={group.id}
            data-project-section={group.id}
            aria-label={group.name}
            style={{ '--group-color': projectColor(group.id) } as CSSProperties}
            className={cn(
              'relative my-1 flex flex-col gap-px rounded-lg pl-2 transition-shadow',
              'before:absolute before:top-0.5 before:bottom-0.5 before:left-0 before:w-[3px] before:rounded-full before:bg-(--group-color)',
              dropTarget === group.id && 'ring-1 ring-accent-line',
            )}
            {...dropZone(group.id, ids => save(addToGroup(groups, group.id, ids)))}
          >
            <GroupHeader
              group={group}
              open={open}
              count={members.length}
              running={totals.running}
              waiting={totals.waiting}
              onToggle={() => setProjectsCollapsed([groupKey(group.id)], open)}
              onMenu={(x, y) => setGroupMenu({ group, x, y })}
            />
            {open && <div className="flex flex-col gap-px">{members.map(renderProject)}</div>}
          </section>
        )
      })}
      {groupMenu && (
        <ActionMenu
          x={groupMenu.x}
          y={groupMenu.y}
          label={tr('sidebar.group.menu')}
          onClose={() => setGroupMenu(null)}
          actions={[
            { label: tr('sidebar.group.rename'), icon: PencilLine, run: () => setNaming({ group: groupMenu.group }) },
            {
              label: tr('sidebar.group.dissolve'),
              icon: Ungroup,
              run: () => save(dissolveGroup(groups, groupMenu.group.id)),
            },
          ]}
        />
      )}
      {naming && (
        <GroupNameDialog
          title={tr('ids' in naming ? 'sidebar.group.newTitle' : 'sidebar.group.renameTitle')}
          initial={'ids' in naming ? tr('sidebar.group.defaultName') : naming.group.name}
          onSave={name =>
            'ids' in naming
              ? save(createGroup(groups, { id: newGroupId(), name }, naming.ids))
              : save(renameGroup(groups, naming.group.id, name))
          }
          onClose={() => setNaming(null)}
        />
      )}
    </div>
  )
}

/** 分区标题（版本 4）：分区色淡底，箭头 + 分区色图标和名字 + 「N 个项目」，右边是组里在跑 / 等你的合计；悬停出 ⋯，右键同一个菜单 */
function GroupHeader({
  group,
  open,
  count,
  running,
  waiting,
  onToggle,
  onMenu,
}: {
  group: ProjectGroup
  open: boolean
  count: number
  running: number
  waiting: number
  onToggle: () => void
  onMenu: (x: number, y: number) => void
}) {
  return (
    <div
      data-section-header={group.id}
      onContextMenu={event => {
        event.preventDefault()
        onMenu(event.clientX, event.clientY)
      }}
      className="group/section relative flex h-7 min-w-0 shrink-0 items-center rounded-md bg-[color-mix(in_srgb,var(--group-color)_14%,transparent)] hover:bg-[color-mix(in_srgb,var(--group-color)_22%,transparent)]"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        title={group.name}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pl-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <ChevronRight
          size={12}
          strokeWidth={1.75}
          className={cn('shrink-0 text-fg-faint transition-transform duration-150', open && 'rotate-90')}
        />
        <Boxes size={14} strokeWidth={1.6} className="shrink-0 text-(color:--group-color)" />
        <span className="min-w-0 truncate text-list font-semibold text-(color:--group-color)">{group.name}</span>
        <span className="shrink-0 text-meta text-fg-faint">{tr('sidebar.group.count', { count })}</span>
      </button>
      <span className="flex shrink-0 items-center pr-1.5 group-focus-within/section:invisible group-hover/section:invisible">
        <StatusPills running={running} waiting={waiting} />
      </span>
      <button
        type="button"
        aria-haspopup="menu"
        aria-label={tr('sidebar.group.actions', { name: group.name })}
        title={tr('sidebar.group.menu')}
        onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          onMenu(rect.left, rect.bottom + 4)
        }}
        className="invisible absolute right-1 flex size-6 items-center justify-center rounded-md text-fg-muted group-focus-within/section:visible group-hover/section:visible hover:bg-selected hover:text-fg"
      >
        <Ellipsis size={16} strokeWidth={1.5} />
      </button>
    </div>
  )
}

/** 在跑几个（橙色胶囊带转圈）、等你几个（黄底数字）；项目行和分区标题共用 */
function StatusPills({ running, waiting }: { running: number; waiting: number }) {
  if (!running && !waiting) return null
  return (
    <span className="flex shrink-0 items-center gap-1 text-meta tabular-nums">
      {running > 0 && (
        <span
          data-project-running={running}
          title={tr('sidebar.tree.running', { count: running })}
          className="flex h-4 items-center gap-0.5 rounded-full bg-active/12 pr-1.5 pl-1 text-active"
        >
          <Spinner size={10} className="text-active!" />
          {running}
        </span>
      )}
      {waiting > 0 && (
        <span
          data-project-waiting={waiting}
          title={tr('sidebar.tree.waiting', { count: waiting })}
          className="flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1 font-semibold text-panel"
        >
          {waiting}
        </span>
      )}
    </span>
  )
}

/** 项目行右边：在跑 / 等你的数目；都没有时，收起或没对话就写「N 个对话 · 时间」/「还没有对话」 */
function ProjectStatus({
  project,
  open,
  running,
  waiting,
}: {
  project: Project
  open: boolean
  running: number
  waiting: number
}) {
  if (running || waiting) return <StatusPills running={running} waiting={waiting} />
  if (!project.sessions.length)
    return <span className="shrink-0 pr-1 text-meta text-fg-faint">{tr('sidebar.tree.empty')}</span>
  if (open) return null
  const time = project.sessions[0]?.time
  return (
    <span className="shrink-0 pr-1 text-meta text-fg-faint">
      {time ? tr('sidebar.tree.summary', { count: project.sessions.length, time }) : project.sessions.length}
    </span>
  )
}

/** 竖线下面的小字行：「还有 N 个对话 ›」/「收起」、「已归档 N 个」 */
function MoreRow({
  label,
  open,
  onClick,
  icon,
}: {
  label: string
  open: boolean
  onClick: () => void
  icon?: boolean
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className="flex h-7 w-full min-w-0 shrink-0 items-center gap-1.5 rounded-md pr-2.5 pl-[28px] text-left text-meta text-fg-muted hover:bg-hover hover:text-fg"
    >
      {icon && <Archive size={12} strokeWidth={1.5} className="-ml-[18px] shrink-0" />}
      <span className="min-w-0 truncate">{label}</span>
      <ChevronRight
        size={12}
        strokeWidth={1.75}
        className={cn('shrink-0 transition-transform duration-150', open && (icon ? 'rotate-90' : '-rotate-90'))}
      />
    </button>
  )
}
