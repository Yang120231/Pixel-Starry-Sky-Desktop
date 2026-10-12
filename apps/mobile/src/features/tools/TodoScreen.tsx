// 任务（docs/mobile-remote.md §18.4，同电脑的任务面板）：这个项目的待办（我的）和 AI 的计划。
// 手机上能加待办、改状态（开始做 / 完成 / 重新打开）、交给 AI（在项目里新建会话，输入框里放好任务内容）。
import { useState } from 'react'
import { Check, Circle, CircleDot, Flag, ListChecks, Plus } from 'lucide-react'
import type { TodoStep } from '@pixelsky/protocol'
import { ago } from '@/data/tasks'
import { callTool, toolError, useToolData, type ManualTask, type TaskState, type TaskStatus } from '@/data/tools'
import { Banner, Empty, Section, Spinner, cn } from '@/ui'
import { ActionSheet, type SheetAction } from '@/ui/sheet'
import { Loading, ToolFrame, type ToolProps } from './common'

/** 已完成先列几条 */
const DONE_STEP = 10

const GROUPS: readonly { status: TaskStatus; title: string }[] = [
  { status: 'in_progress', title: '进行中' },
  { status: 'pending', title: '待办' },
  { status: 'completed', title: '已完成' },
]

export function TodoScreen(tool: ToolProps) {
  const state = useToolData<TaskState>(tool.deviceId, 'projectTools:tasks', [tool.project.id], true)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<ManualTask | null>(null)
  const [doneLimit, setDoneLimit] = useState(DONE_STEP)
  const data = state.data

  const write = async (method: string, ...args: unknown[]) => {
    setBusy(true)
    setError(null)
    try {
      await callTool(tool.deviceId, method, ...args)
      state.reload()
      return true
    } catch (e) {
      setError(toolError(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  const add = async () => {
    const text = title.trim()
    if (text && (await write('projectTools:createTask', tool.project.id, { title: text }))) setTitle('')
  }
  const setStatus = (task: ManualTask, status: TaskStatus) => void write('projectTools:updateTask', task.id, { status })

  const actions = (task: ManualTask): SheetAction[] => [
    ...(task.status !== 'in_progress' && task.status !== 'completed'
      ? [{ label: '开始做', onSelect: () => setStatus(task, 'in_progress') }]
      : []),
    ...(task.status !== 'completed'
      ? [{ label: '标记完成', onSelect: () => setStatus(task, 'completed') }]
      : [{ label: '重新打开', onSelect: () => setStatus(task, 'pending') }]),
    {
      label: '交给 AI',
      hint: '在这个项目里新建会话，任务内容先放进输入框',
      onSelect: () => {
        if (task.status === 'pending') setStatus(task, 'in_progress')
        tool.onNewSession(tool.project.id, task.note.trim() ? `${task.title}\n\n${task.note.trim()}` : task.title)
      },
    },
  ]

  return (
    <ToolFrame
      tool={tool}
      title="任务"
      loading={state.loading}
      onRefresh={state.reload}
      footer={
        tool.canAct && (
          <form
            className="flex items-center gap-2 border-t border-line-subtle px-3 py-2.5"
            onSubmit={e => {
              e.preventDefault()
              void add()
            }}
          >
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={200}
              enterKeyHint="done"
              placeholder="添加待办…"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-composer bg-surface px-3 text-prose outline-none focus:border-line-composer-focus"
            />
            <button
              type="submit"
              aria-label="添加"
              disabled={busy || !title.trim()}
              className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-full',
                title.trim() ? 'bg-primary text-primary-fg' : 'bg-subtle text-fg-faint',
              )}
            >
              {busy ? <Spinner size={15} /> : <Plus size={20} />}
            </button>
          </form>
        )
      }
    >
      {!data ? (
        <Loading error={state.error} />
      ) : (
        <div className="flex flex-col gap-5 pt-1 pb-6">
          {(error ?? state.error) && <Banner tone="danger">{error ?? state.error}</Banner>}
          {!data.tasks.length && !data.plans.length && (
            <Empty icon={ListChecks} title="还没有任务" body="在下面添加一条待办，或者让 AI 做个计划。" />
          )}
          {GROUPS.map(({ status, title: heading }) => {
            let list = data.tasks.filter(t => t.status === status)
            if (!list.length) return null
            const done = status === 'completed'
            if (done) list = [...list].sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt))
            const shown = done ? list.slice(0, doneLimit) : list
            return (
              <Section
                key={status}
                title={
                  <>
                    {heading}
                    <span className="text-fg-faint">{list.length}</span>
                  </>
                }
              >
                {shown.map((t, i) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    first={i === 0}
                    canAct={tool.canAct && !busy}
                    onToggle={() => setStatus(t, done ? 'pending' : 'completed')}
                    onMenu={() => setMenu(t)}
                  />
                ))}
                {shown.length < list.length && (
                  <button
                    type="button"
                    onClick={() => setDoneLimit(n => n + DONE_STEP)}
                    className="flex min-h-12 w-full items-center justify-center border-t border-line-subtle text-meta text-accent-fg active:bg-hover"
                  >
                    显示更多（还有 {list.length - shown.length} 条）
                  </button>
                )}
              </Section>
            )
          })}
          {data.plans.map(plan => (
            <Section
              key={plan.sessionId}
              title={
                <>
                  AI 计划 · <span className="truncate">{plan.title || '未命名会话'}</span>
                </>
              }
            >
              <button
                type="button"
                onClick={() => tool.onOpenSession(plan.sessionId)}
                className="flex w-full flex-col py-1.5 text-left active:bg-hover"
              >
                {plan.item.steps.map((step, i) => (
                  <Step key={i} step={step} />
                ))}
              </button>
            </Section>
          ))}
        </div>
      )}
      {menu && <ActionSheet title={menu.title} actions={actions(menu)} onClose={() => setMenu(null)} />}
    </ToolFrame>
  )
}

function TaskRow({
  task,
  first,
  canAct,
  onToggle,
  onMenu,
}: {
  task: ManualTask
  first: boolean
  canAct: boolean
  onToggle(): void
  onMenu(): void
}) {
  const done = task.status === 'completed'
  return (
    <div className={cn('flex items-start', !first && 'border-t border-line-subtle')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `重新打开「${task.title}」` : `完成「${task.title}」`}
        disabled={!canAct}
        onClick={onToggle}
        className="flex size-12 shrink-0 items-center justify-center text-fg-muted disabled:opacity-60"
      >
        {done ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-fg">
            <Check size={13} strokeWidth={3} />
          </span>
        ) : task.status === 'in_progress' ? (
          <CircleDot size={20} className="text-accent-fg" />
        ) : (
          <Circle size={20} />
        )}
      </button>
      <button
        type="button"
        disabled={!canAct}
        onClick={onMenu}
        className="flex min-h-12 min-w-0 flex-1 flex-col justify-center gap-0.5 py-2.5 pr-4 text-left active:bg-hover disabled:active:bg-transparent"
      >
        <span className={cn('text-ui', done && 'text-fg-muted line-through')}>
          {task.priority === 'high' && <Flag size={13} className="mr-1 inline text-danger" />}
          {task.title}
        </span>
        {task.note && <span className="line-clamp-2 text-meta text-fg-muted">{task.note}</span>}
        <span className="text-label text-fg-faint">
          {task.due ? `截止 ${task.due} · ` : ''}
          {ago(done ? (task.completedAt ?? task.updatedAt) : task.updatedAt)}
        </span>
      </button>
    </div>
  )
}

function Step({ step }: { step: TodoStep }) {
  return (
    <span className="flex items-start gap-2.5 px-4 py-1.5">
      {step.status === 'completed' ? (
        <Check size={16} className="mt-0.5 shrink-0 text-success" />
      ) : step.status === 'in_progress' ? (
        <CircleDot size={16} className="mt-0.5 shrink-0 text-accent-fg" />
      ) : (
        <Circle size={16} className="mt-0.5 shrink-0 text-fg-faint" />
      )}
      <span className={cn('text-meta', step.status === 'completed' ? 'text-fg-muted line-through' : 'text-fg')}>
        {step.text}
      </span>
    </span>
  )
}
