// 左侧栏「固定任务」（docs/ui/files-search-terminal-pins.md §5）：任务清单里固定的任务，点击打开右侧任务并定位，
// 圆圈勾选完成；拖动任务卡片到侧栏任意位置松开也能固定（Sidebar 负责接收拖放）。
import { useState } from 'react'
import { Check, Circle, ExternalLink, PinOff } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../i18n/core'
import { ActionMenu } from '@/ui/ActionMenu'
import { cn } from '@/ui'
import { isDemo, projects as demoProjects } from '@/data'
import { useEngineState } from '@/features/engine'
import { openTask as openTaskIn } from '@/features/panel/openTask'
import { pinTask, togglePinnedDone, usePinnedTasks } from '@/features/panel/pinnedTasks'
import type { ManualTask } from '../../../../shared/types/project-tools'
import { SidebarSection } from './SidebarSection'

/** 打开任务：右侧打开「任务」并定位，尽量不新开标签（features/panel/openTask.ts） */
const openTask = (task: ManualTask): void => openTaskIn(task.projectId, task.id)

const statusKey = {
  pending: 'projectTools.pending',
  in_progress: 'projectTools.inProgress',
  review: 'projectTools.review',
  completed: 'projectTools.completed',
} as const

export function PinnedTasks({ dropping }: { dropping: boolean }) {
  useI18n()
  const tasks = usePinnedTasks()
  const realProjects = useEngineState(s => s.projects)
  const names = isDemo ? demoProjects : realProjects
  const [menu, setMenu] = useState<{ task: ManualTask; x: number; y: number; trigger: HTMLElement } | null>(null)
  const [error, setError] = useState('')
  const act = (job: Promise<unknown>): void => {
    setError('')
    job.catch(e => setError((e as Error).message))
  }
  if (!tasks.length && !dropping) return null
  return (
    <SidebarSection title={tr('sidebar.pinnedTasks')}>
      <div data-sidebar-pinned-tasks className="flex flex-col gap-px">
        {tasks.map(task => {
          const done = task.status === 'completed'
          const project = names.find(p => p.id === task.projectId)?.name ?? ''
          return (
            <div
              key={task.id}
              data-pinned-task={task.id}
              className="group flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-md pr-1 pl-1.5 text-list text-fg-secondary hover:bg-hover"
              onContextMenu={e => {
                e.preventDefault()
                setMenu({ task, x: e.clientX, y: e.clientY, trigger: e.currentTarget })
              }}
            >
              <button
                type="button"
                aria-label={tr(done ? 'sidebar.markNotDone' : 'sidebar.markDone') + ': ' + task.title}
                aria-pressed={done}
                onClick={() => act(togglePinnedDone(task))}
                className="flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:text-fg"
              >
                {done ? <Check size={14} strokeWidth={1.75} /> : <Circle size={14} strokeWidth={1.5} />}
              </button>
              <button
                type="button"
                title={task.title + (project ? ' · ' + project : '')}
                onClick={() => openTask(task)}
                className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
              >
                <span className={cn('min-w-0 truncate', done && 'text-fg-muted line-through')}>{task.title}</span>
                <span className="min-w-0 shrink truncate text-meta text-fg-faint">
                  {project ? project + ' · ' : ''}
                  {tr(statusKey[task.status])}
                </span>
              </button>
            </div>
          )
        })}
        {dropping && (
          <div className="flex h-8 items-center rounded-md border border-dashed border-accent-line px-2.5 text-meta text-accent-fg">
            {tr('sidebar.dropToPin')}
          </div>
        )}
        {error && (
          <p role="alert" className="px-2.5 text-label text-danger">
            {translateMessage(error)}
          </p>
        )}
      </div>
      {menu && (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          label={menu.task.title}
          onClose={() => {
            setMenu(null)
            menu.trigger.focus({ preventScroll: true })
          }}
          actions={[
            { label: tr('sidebar.openTask'), icon: ExternalLink, run: () => openTask(menu.task) },
            {
              label: tr(menu.task.status === 'completed' ? 'sidebar.markNotDone' : 'sidebar.markDone'),
              icon: Check,
              run: () => act(togglePinnedDone(menu.task)),
            },
            { label: tr('sidebar.unpinTask'), icon: PinOff, run: () => act(pinTask(menu.task, false)) },
          ]}
        />
      )}
    </SidebarSection>
  )
}
