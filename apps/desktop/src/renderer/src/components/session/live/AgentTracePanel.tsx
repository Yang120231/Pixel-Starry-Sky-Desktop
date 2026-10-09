import { translateMessage } from '../../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
// 智能体追踪面板（docs/engines.md §15.4，参考 JuCode AgentRunsPanel）：
// 会话主区右侧的抽屉。总览：每个多智能体编排一节（按阶段、共用时间轴），再加「子智能体（Agent 工具）」一节；
// 点一个智能体进入它的会话（只读），还在运行时每 2.5 秒刷新。
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bot, Check, ChevronRight, CircleDashed, Minus, Workflow, X, type LucideIcon } from 'lucide-react'
import type { AgentRun, AgentRuns, Item, WorkflowRun } from '@pixelsky/protocol'
import { IconButton, Spinner, cn } from '@/components/ui'
import { bridge } from '@/engine'
import {
  RUN_STATE_LABEL,
  anyRunning,
  byPhase,
  elapsed,
  formatCount,
  formatDuration,
  progress,
  runState,
  shortModel,
  timeline,
  type RunState,
} from './agentTrace'
import { Markdown } from './Markdown'
import { ReasoningBlock, ToolItemRow, UserBubble } from './ItemRows'

const STATE_ICON: Record<RunState, LucideIcon | null> = {
  running: null,
  done: Check,
  failed: X,
  stopped: Minus,
  queued: CircleDashed,
}

function StateIcon({ state }: { state: string }) {
  useI18n()
  const s = runState(state)
  const Icon = STATE_ICON[s]
  return (
    <span className="inline-flex w-4 shrink-0 justify-center" title={RUN_STATE_LABEL[s]}>
      {Icon ? (
        <Icon
          size={13}
          strokeWidth={2}
          className={cn(
            s === 'done' && 'text-success',
            s === 'failed' && 'text-danger',
            (s === 'stopped' || s === 'queued') && 'text-fg-faint',
          )}
        />
      ) : (
        <Spinner size={12} />
      )}
    </span>
  )
}

/** 一行智能体：状态、名字、类型 · 模型、时间线条、耗时、tokens、工具次数 */
function AgentRow({
  a,
  bar,
  now,
  onPick,
}: {
  a: AgentRun
  bar?: { left: number; width: number }
  now: number
  onPick: (id: string) => void
}) {
  useI18n()
  const s = runState(a.state)
  return (
    <button
      type="button"
      disabled={!a.id}
      onClick={() => onPick(a.id)}
      title={a.prompt || a.label}
      className="grid w-full grid-cols-[16px_minmax(0,1.3fr)_minmax(0,1fr)_64px_70px_36px] items-center gap-2 rounded-md px-2 py-1.5 text-left text-meta hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent"
    >
      <StateIcon state={a.state} />
      <span className="min-w-0">
        <span className="block truncate text-list text-fg">
          {a.label || a.id || tr('session.live.AgentTracePanel.message202')}
        </span>
        <span className="block truncate text-label text-fg-faint">
          {[a.type, shortModel(a.model)].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="relative h-1.5 rounded-full bg-subtle">
        {bar && (
          <span
            className={cn(
              'absolute inset-y-0 rounded-full',
              s === 'running' && 'bg-accent',
              s === 'done' && 'bg-fg-muted',
              s === 'failed' && 'bg-danger',
              (s === 'stopped' || s === 'queued') && 'bg-line-strong',
            )}
            style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
          />
        )}
      </span>
      <span className="text-right text-fg-muted tabular-nums">{formatDuration(elapsed(a, s, now))}</span>
      <span className="text-right text-fg-muted tabular-nums">{formatCount(a.tokens)}</span>
      <span className="text-right text-fg-muted tabular-nums">{a.toolCalls}</span>
    </button>
  )
}

function ColumnHead() {
  useI18n()
  return (
    <div className="grid grid-cols-[16px_minmax(0,1.3fr)_minmax(0,1fr)_64px_70px_36px] gap-2 px-2 pb-1 text-label text-fg-faint">
      <span />
      <span>{tr('session.contextData.message145')}</span>
      <span>{tr('session.live.AgentTracePanel.message203')}</span>
      <span className="text-right">{tr('session.live.AgentTracePanel.message204')}</span>
      <span className="text-right">Tokens</span>
      <span className="text-right">{tr('session.live.AgentTracePanel.message205')}</span>
    </div>
  )
}

function WorkflowSection({
  run,
  open,
  onToggle,
  now,
  onPick,
}: {
  run: WorkflowRun
  open: boolean
  onToggle: () => void
  now: number
  onPick: (id: string) => void
}) {
  useI18n()
  const bars = useMemo(() => timeline(run.agents, now), [run.agents, now])
  const p = progress(run)
  const s = runState(run.status)
  return (
    <section className="rounded-xl border border-line bg-surface shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <ChevronRight
          size={14}
          strokeWidth={1.5}
          className={cn('shrink-0 text-fg-muted transition-transform duration-(--dur-fast)', open && 'rotate-90')}
        />
        <Workflow size={15} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium text-fg">{run.name || run.description || run.id}</span>
          {run.name && run.description && (
            <span className="block truncate text-meta text-fg-muted">{run.description}</span>
          )}
        </span>
        <StateIcon state={run.status} />
      </button>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 pb-2 pl-[52px] text-meta text-fg-muted tabular-nums">
        <span>{RUN_STATE_LABEL[s]}</span>
        {p.total > 0 && (
          <span>
            {p.done}/{p.total}
            {tr('session.live.AgentTracePanel.message206')}{' '}
          </span>
        )}
        <span>{formatDuration(elapsed(run, s, now))}</span>
        <span>{formatCount(run.tokens)} tokens</span>
        <span>
          {run.toolCalls}
          {tr('session.live.AgentTracePanel.message207')}{' '}
        </span>
      </div>
      {open && (
        <div className="border-t border-line-subtle px-1.5 pt-2 pb-1.5">
          {run.agents.length === 0 ? (
            <div className="px-2 py-2 text-meta text-fg-faint">{tr('session.live.AgentTracePanel.message208')}</div>
          ) : (
            <>
              <ColumnHead />
              {byPhase(run).map((g, i) => (
                <div key={i}>
                  {g.title && <div className="px-2 pt-1.5 pb-0.5 text-label font-medium text-fg-muted">{g.title}</div>}
                  {g.agents.map((a, j) => (
                    <AgentRow
                      key={a.id || `${i}-${j}`}
                      a={a}
                      bar={bars.get(a.id || a.label)}
                      now={now}
                      onPick={onPick}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function TranscriptItem({ item }: { item: Item }) {
  useI18n()
  switch (item.kind) {
    case 'user':
      return <UserBubble item={item} />
    case 'assistant':
      return <Markdown text={item.text} />
    case 'reasoning':
      return <ReasoningBlock item={item} />
    case 'command':
    case 'file_change':
    case 'tool':
      return <ToolItemRow item={item} />
    default:
      return null
  }
}

/** 一个智能体的详情：任务说明 + 它的对话（只读） */
function AgentFocus({
  sessionId,
  agent,
  run,
  now,
  onBack,
}: {
  sessionId: string
  agent: AgentRun
  run: WorkflowRun | null
  now: number
  onBack: () => void
}) {
  useI18n()
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [taskOpen, setTaskOpen] = useState(false)
  const s = runState(agent.state)
  const live = s === 'running'

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      bridge
        ?.subagentTranscript(sessionId, agent.id)
        .then(list => {
          if (cancelled) return
          setItems(list)
          setError(null)
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message)
        })
    }
    load()
    const timer = live ? window.setInterval(load, 2500) : undefined
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [sessionId, agent.id, live])

  // 第一条用户消息就是任务说明，单独折叠显示
  const task = items?.[0]?.kind === 'user' ? items[0].text : agent.prompt
  const rest = items?.[0]?.kind === 'user' ? items.slice(1) : (items ?? [])

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-meta text-fg-muted hover:bg-hover hover:text-fg"
      >
        <ArrowLeft size={14} strokeWidth={1.5} />
        {tr('session.live.AgentTracePanel.message209')}{' '}
      </button>
      <div>
        <div className="flex items-center gap-2">
          <StateIcon state={agent.state} />
          <span className="min-w-0 truncate text-section font-semibold text-fg">{agent.label || agent.id}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-6 text-meta text-fg-muted tabular-nums">
          {run && <span>{run.name || run.description}</span>}
          {[agent.type, shortModel(agent.model)].filter(Boolean).length > 0 && (
            <span>{[agent.type, shortModel(agent.model)].filter(Boolean).join(' · ')}</span>
          )}
          <span>{RUN_STATE_LABEL[s]}</span>
          <span>{formatDuration(elapsed(agent, s, now))}</span>
          <span>{formatCount(agent.tokens)} tokens</span>
          <span>
            {agent.toolCalls}
            {tr('session.live.AgentTracePanel.message207')}{' '}
          </span>
        </div>
      </div>
      {task && (
        <section className="rounded-lg border border-line bg-surface">
          <button
            type="button"
            onClick={() => setTaskOpen(v => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-meta font-medium text-fg-secondary"
          >
            <ChevronRight
              size={13}
              strokeWidth={1.5}
              className={cn('transition-transform duration-(--dur-fast)', taskOpen && 'rotate-90')}
            />
            {tr('session.live.AgentTracePanel.message210')}{' '}
          </button>
          {taskOpen && (
            <div className="border-t border-line-subtle px-3 py-2">
              <Markdown text={task} />
            </div>
          )}
        </section>
      )}
      {agent.result && !items?.length && (
        <div className="text-meta text-fg-muted">
          {tr('session.live.AgentTracePanel.message211')}
          {agent.result}
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {error ? (
          <div className="text-meta text-fg-faint">{translateMessage(error)}</div>
        ) : items === null ? (
          <div className="flex items-center gap-2 text-meta text-fg-muted">
            <Spinner size={12} />
            {tr('session.live.AgentTracePanel.message212')}{' '}
          </div>
        ) : rest.length === 0 ? (
          <div className="text-meta text-fg-faint">{tr('session.live.AgentTracePanel.message213')}</div>
        ) : (
          rest.map(it => <TranscriptItem key={it.id} item={it} />)
        )}
      </div>
    </div>
  )
}

export interface AgentTracePanelProps {
  sessionId: string
  runs: AgentRuns
  /** 打开时定位的智能体；null 表示总览 */
  focus: string | null
  onFocus: (agentId: string | null) => void
  onClose: () => void
}

export function AgentTracePanel({ sessionId, runs, focus, onFocus, onClose }: AgentTracePanelProps) {
  useI18n()
  const [now, setNow] = useState(() => Date.now())
  const running = anyRunning(runs.workflows, runs.agents)
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [running])

  // 运行中的和最新的一个编排默认展开
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const isOpen = (w: WorkflowRun, i: number) =>
    open[w.id] ?? (runState(w.status) === 'running' || i === runs.workflows.length - 1)

  const focused = useMemo(() => {
    if (!focus) return null
    for (const w of runs.workflows) {
      const a = w.agents.find(x => x.id === focus)
      if (a) return { agent: a, run: w }
    }
    const a = runs.agents.find(x => x.id === focus)
    return a ? { agent: a, run: null } : null
  }, [focus, runs])

  const totalTokens = [...runs.workflows, ...runs.agents].reduce((n, r) => n + r.tokens, 0)
  const agentBars = useMemo(() => timeline(runs.agents, now), [runs.agents, now])
  const empty = runs.workflows.length === 0 && runs.agents.length === 0

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside
      className="pop-in absolute top-12 right-0 bottom-0 z-30 flex w-[min(560px,92%)] flex-col border-l border-line bg-app shadow-popover"
      aria-label={tr('session.live.AgentTracePanel.message214')}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        <Bot size={16} strokeWidth={1.5} className="shrink-0 text-fg-secondary" />
        <span className="text-ui font-medium text-fg">{tr('session.live.AgentTracePanel.message214')}</span>
        {!empty && (
          <span className="min-w-0 truncate text-meta text-fg-muted tabular-nums">
            {runs.workflows.length}
            {tr('session.live.AgentTracePanel.message215')} {runs.agents.length}
            {tr('session.live.AgentTracePanel.message216')} {formatCount(totalTokens)} tokens
          </span>
        )}
        <span className="flex-1" />
        <IconButton icon={X} label={tr('session.live.AgentTracePanel.message217')} onClick={onClose} />
      </header>
      <div className="selectable min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {focus && focused ? (
          <AgentFocus
            key={focused.agent.id}
            sessionId={sessionId}
            agent={focused.agent}
            run={focused.run}
            now={now}
            onBack={() => onFocus(null)}
          />
        ) : empty ? (
          <div className="flex flex-col items-center px-6 pt-16 text-center">
            <Bot size={28} strokeWidth={1.25} className="text-fg-faint" />
            <div className="mt-3 text-ui text-fg">{tr('session.live.AgentTracePanel.message218')}</div>
            <p className="mt-1.5 max-w-80 text-meta text-fg-muted">{tr('session.live.AgentTracePanel.message219')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {runs.workflows.map((w, i) => (
              <WorkflowSection
                key={w.id}
                run={w}
                open={isOpen(w, i)}
                onToggle={() => setOpen(o => ({ ...o, [w.id]: !isOpen(w, i) }))}
                now={now}
                onPick={onFocus}
              />
            ))}
            {runs.agents.length > 0 && (
              <section className="rounded-xl border border-line bg-surface px-1.5 pt-2.5 pb-1.5 shadow-sm">
                <div className="px-2 pb-2 text-ui font-medium text-fg">
                  {tr('session.live.AgentTracePanel.message220')}
                </div>
                <ColumnHead />
                {runs.agents.map(a => (
                  <AgentRow key={a.id} a={a} bar={agentBars.get(a.id || a.label)} now={now} onPick={onFocus} />
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
