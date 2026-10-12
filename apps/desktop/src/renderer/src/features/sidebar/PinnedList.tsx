import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Pin, SquareKanban } from 'lucide-react'
import { Dot, Spinner, cn } from '@/ui'
import type { PinnedSession } from '@/features/engine/sidebarData'
import { setPage, usePage } from '@/features/layout/page'
import { useBoardTasks } from '@/features/board/boardTasks'
import { useEngineState, isLive } from '@/features/engine'
import { machineOf, useMachines } from '@/features/machines/store'
import { projects as demoProjects } from '@/data'
import { SidebarRow } from './SidebarSection'
import { SessionRow } from './SessionRow'

/** 「任务看板」入口（docs/ui/task-board.md §2）：只管我的任务，显示没完成的手动任务数 */
function BoardEntry() {
  useI18n()
  const page = usePage()
  const { tasks } = useBoardTasks()
  const machine = useMachines().currentId
  const projects = useEngineState(s => s.projects)
  const known = new Set(
    isLive ? projects.filter(p => machineOf(p.id) === machine).map(p => p.id) : demoProjects.map(p => p.id),
  )
  const todo = tasks.filter(t => t.status !== 'completed' && known.has(t.projectId)).length
  return (
    <SidebarRow selected={page === 'board'} onClick={() => setPage('board')} title={tr('board.open')}>
      <SquareKanban size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
        <span className="shrink-0">{tr('board.title')}</span>
        {todo > 0 && (
          <span className="min-w-0 truncate text-meta text-fg-faint">{tr('board.todoCount', { n: todo })}</span>
        )}
      </span>
    </SidebarRow>
  )
}

/** 侧栏「置顶」分组：任务看板入口和置顶的会话（会话菜单里「置顶」，取消也在同一个菜单里） */
export function PinnedList({
  sessions,
  selectedSessionId,
  onSelectSession,
}: {
  sessions: PinnedSession[]
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
}) {
  useI18n()
  return (
    <>
      <BoardEntry />
      {sessions.map(session => {
        const running = session.status === 'running'
        const unread = session.status === 'unread'
        return (
          <SessionRow
            key={session.id}
            target={{ id: session.id, title: session.title, pinned: true, archived: false, running }}
            selected={session.id === selectedSessionId}
            onSelect={onSelectSession}
            trailing={
              <>
                {unread && <Dot tone="accent" className="mr-0.5" />}
                {running && <Spinner size={14} />}
                {!unread && !running && session.time && (
                  <span className="shrink-0 text-meta text-fg-faint">{session.time}</span>
                )}
              </>
            }
          >
            <Pin size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
            <span
              className={cn('min-w-0 flex-1 truncate', unread && 'font-semibold text-fg')}
              title={session.project ? `${session.title} · ${session.project}` : session.title}
            >
              {session.title}
            </span>
          </SessionRow>
        )
      })}
    </>
  )
}
