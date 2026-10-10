import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
// 进度卡片：浮在对话区右上角，显示当前计划和子智能体（docs/ui/progress-card.md，参考 Claude 桌面版）
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Bot, Check, ChevronDown, ChevronUp, CircleSlash, X } from 'lucide-react'
import type { SessionSnapshot, TodoStep } from '@pixelsky/protocol'
import { IconButton, Spinner, cn } from '@/ui'
import { elapsed, formatDuration, shortModel, type RunState } from './agentTrace'
import { activeStep, currentPlan, progressAgents, turnKey, type Plan, type ProgressAgent } from './progressData'
import { useOpenTrace } from './trace'

const COLLAPSED_KEY = 'pixelsky.progress.collapsed'
/** 对话区比这窄时默认折叠 */
const NARROW_PX = 640

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // 存不了就只在这次打开里有效
  }
}

export interface Progress {
  plan: Plan | null
  agents: ProgressAgent[]
  visible: boolean
  dismiss: () => void
}

/** 当前计划、子智能体和是否显示；「关闭」只在这一轮里有效 */
export function useProgress(snapshot: SessionSnapshot | null): Progress {
  const items = snapshot?.items
  const running = !!snapshot && snapshot.state !== 'idle'
  const plan = useMemo(() => (items ? currentPlan(items, running) : null), [items, running])
  const agents = useMemo(
    () => progressAgents(snapshot?.subagents ?? [], snapshot?.runs),
    [snapshot?.subagents, snapshot?.runs],
  )
  const key = `${snapshot?.record.id ?? ''}:${items ? turnKey(items) : ''}`
  const [dismissed, setDismissed] = useState<string | null>(null)
  const dismiss = useCallback(() => setDismissed(key), [key])
  // 只在运行中显示：空闲时计划和子智能体都在这一轮收起的执行块里（docs/ui/conversation-concise.md §3 F）
  return { plan, agents, visible: running && dismissed !== key && (!!plan || agents.length > 0), dismiss }
}

/** 步骤前的圆圈：完成打勾、进行中主色圆点、未开始空心 */
export function StepMark({ status }: { status: TodoStep['status'] }) {
  return (
    <span
      className={cn(
        'mt-[3px] inline-flex size-[14px] shrink-0 items-center justify-center rounded-full border',
        status === 'completed' && 'border-success bg-success text-surface',
        status === 'in_progress' && 'border-accent',
        status === 'pending' && 'border-line-strong',
      )}
    >
      {status === 'completed' && <Check size={10} strokeWidth={3} />}
      {status === 'in_progress' && <span className="size-1.5 animate-pulse rounded-full bg-accent" />}
    </span>
  )
}

function StateIcon({ state }: { state: RunState }) {
  if (state === 'running') return <Spinner size={12} className="mt-[3px]" />
  if (state === 'done') return <Check size={12} strokeWidth={2} className="mt-[3px] shrink-0 text-success" />
  if (state === 'failed') return <X size={12} strokeWidth={2} className="mt-[3px] shrink-0 text-danger" />
  return <CircleSlash size={12} strokeWidth={1.75} className="mt-[3px] shrink-0 text-fg-muted" />
}

/** 运行中的子智能体每秒刷新已用时间 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active])
  return now
}

function summary(plan: Plan | null, agents: ProgressAgent[]): string {
  const parts: string[] = []
  if (plan) parts.push(tr('session.progress.steps', { done: plan.done, total: plan.steps.length }))
  const running = agents.filter(a => a.state === 'running').length
  if (running > 0) parts.push(tr('session.progress.agentsRunning', { n: running }))
  else if (agents.length > 0) parts.push(tr('session.progress.agents', { n: agents.length }))
  return parts.join(' · ')
}

function Steps({ steps }: { steps: TodoStep[] }) {
  const list = useRef<HTMLOListElement>(null)
  const active = activeStep(steps)
  // 当前步骤变了：只滚动步骤列表本身，不带动对话流
  useLayoutEffect(() => {
    const el = list.current
    const row = active >= 0 ? (el?.children[active] as HTMLElement | undefined) : undefined
    if (!el || !row) return
    if (row.offsetTop < el.scrollTop || row.offsetTop + row.offsetHeight > el.scrollTop + el.clientHeight)
      el.scrollTop = row.offsetTop - (el.clientHeight - row.offsetHeight) / 2
  }, [active, steps.length])
  return (
    <ol ref={list} className="relative flex max-h-[15.5rem] flex-col overflow-y-auto px-1.5">
      {steps.map((s, i) => (
        <li
          key={i}
          aria-current={i === active ? 'step' : undefined}
          className={cn(
            'flex items-start gap-2 rounded-md px-1.5 py-[3px] text-list',
            i === active && 'bg-accent-soft',
          )}
        >
          <StepMark status={s.status} />
          <span
            className={cn(
              'min-w-0 break-words',
              s.status === 'completed' ? 'text-fg-muted' : 'text-fg',
              i === active && 'font-medium',
            )}
          >
            {s.text}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Agents({ agents, divided }: { agents: ProgressAgent[]; divided: boolean }) {
  const openTrace = useOpenTrace()
  const now = useNow(agents.some(a => a.state === 'running'))
  return (
    <div className={cn('px-1.5', divided && 'mt-1.5 border-t border-line-subtle pt-1.5')}>
      <div className="px-1.5 pb-0.5 text-meta text-fg-faint">
        {tr('session.progress.subagents')} <span className="tabular-nums">{agents.length}</span>
      </div>
      <ul className="flex max-h-[11rem] flex-col overflow-y-auto">
        {agents.map(a => {
          const time = elapsed(a, a.state, now)
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => openTrace?.({ agentId: a.id })}
                title={tr('session.live.SessionStrips.viewSubagentConversation')}
                className="press flex w-full min-w-0 items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-hover"
              >
                <StateIcon state={a.state} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5 text-list">
                    <span className="min-w-0 truncate text-fg">{a.label}</span>
                    {a.model && <span className="shrink-0 text-meta text-fg-faint">{shortModel(a.model)}</span>}
                    {a.type && (
                      <span className="shrink-0 rounded-sm border border-line px-1 text-meta leading-[1.4] text-fg-muted">
                        {a.type}
                      </span>
                    )}
                    <span className="flex-1" />
                    {time > 0 && (
                      <span className="shrink-0 text-meta text-fg-faint tabular-nums">{formatDuration(time)}</span>
                    )}
                  </span>
                  {a.message && (
                    <span className="truncate font-mono text-meta text-fg-muted" title={a.message}>
                      {a.message}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function ProgressCard({
  progress,
  belowFind,
  offset = 0,
  onOpenTrace,
}: {
  progress: Progress
  /** 对话内搜索条打开着：卡片挪到搜索条下面 */
  belowFind?: boolean
  /** 上面后台任务条的高度：卡片放到任务条下面，不盖住「输出 / 停止」 */
  offset?: number
  onOpenTrace?: () => void
}) {
  useI18n()
  const card = useRef<HTMLElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null)
  const [stored] = useState(readCollapsed)
  // 量对话区（卡片的定位容器）的宽度：窄窗格默认折叠
  useLayoutEffect(() => {
    const box = card.current?.parentElement
    if (!box) return
    const measure = (): void => setNarrow(box.clientWidth < NARROW_PX)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [])
  const collapsed = userCollapsed ?? (stored || narrow)
  const toggle = (): void => {
    setUserCollapsed(!collapsed)
    saveCollapsed(!collapsed)
  }
  const { plan, agents } = progress
  return (
    <section
      ref={card}
      aria-label={tr('session.progress.title')}
      style={{ top: (belowFind ? 56 : 12) + offset }}
      className={cn(
        'pop-in absolute right-5 z-20',
        'flex max-h-[60%] w-[min(22rem,calc(100%-2rem))] flex-col rounded-xl border border-line bg-popover py-2 shadow-popover',
      )}
    >
      <div className="flex items-center gap-1 pr-1.5 pl-3">
        <span className="text-list font-medium text-fg">{tr('session.progress.title')}</span>
        <span className="flex-1" />
        {onOpenTrace && (
          <IconButton
            icon={Bot}
            label={tr('session.live.AgentTracePanel.agentActivity')}
            size={24}
            iconSize={14}
            onClick={onOpenTrace}
          />
        )}
        <IconButton
          icon={collapsed ? ChevronDown : ChevronUp}
          label={tr(collapsed ? 'session.progress.expand' : 'session.progress.collapse')}
          aria-expanded={!collapsed}
          size={24}
          iconSize={14}
          onClick={toggle}
        />
        <IconButton
          icon={X}
          label={tr('session.progress.dismiss')}
          size={24}
          iconSize={14}
          onClick={progress.dismiss}
        />
      </div>
      <div className="px-3 pb-1 text-meta text-fg-muted tabular-nums">{summary(plan, agents)}</div>
      {!collapsed && (
        <div className="flex min-h-0 flex-col overflow-y-auto">
          {plan && <Steps steps={plan.steps} />}
          {agents.length > 0 && <Agents agents={agents} divided={!!plan} />}
        </div>
      )}
    </section>
  )
}
