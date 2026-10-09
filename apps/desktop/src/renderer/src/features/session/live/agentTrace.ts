import { tr } from '../../../i18n/core'
// 智能体追踪的显示规则（参考 JuCode agentTrace.ts）：状态归类、共用时间轴、数字格式
import type { AgentRun, WorkflowRun } from '@pixelsky/protocol'

export type RunState = 'running' | 'done' | 'failed' | 'stopped' | 'queued'

export const RUN_STATE_LABEL: Record<RunState, string> = {
  get running() {
    return tr('session.live.agentTrace.running')
  },
  get done() {
    return tr('session.live.agentTrace.completed')
  },
  get failed() {
    return tr('session.live.agentTrace.failed')
  },
  get stopped() {
    return tr('session.live.agentTrace.stopped')
  },
  get queued() {
    return tr('session.live.agentTrace.queued')
  },
}

/** 引擎的各种状态词（done、completed、killed、pending …）归成五种 */
export function runState(state: string): RunState {
  switch (state) {
    case 'running':
    case 'start':
    case 'started':
    case 'async_launched':
      return 'running'
    case 'done':
    case 'completed':
    case 'success':
      return 'done'
    case 'failed':
    case 'error':
      return 'failed'
    case 'stopped':
    case 'killed':
    case 'cancelled':
    case 'skipped':
    case 'interrupted':
      return 'stopped'
    default:
      return state ? 'queued' : 'done'
  }
}

/** 已用时间：报告的时长；运行中时取「从开始到现在」 */
export function elapsed(run: { startedAt: number; durationMs: number }, state: RunState, now: number): number {
  if (state === 'running' && run.startedAt > 0) return Math.max(run.durationMs, now - run.startedAt)
  return run.durationMs
}

/** 1.8 秒、12 秒、2 分 05 秒、1 小时 02 分 */
export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return tr('session.live.agentTrace.n0s')
  const s = ms / 1000
  if (s < 60) return tr('session.live.agentTrace.s', { p0: s < 10 ? s.toFixed(1) : Math.round(s) })
  const m = Math.floor(s / 60)
  if (m < 60) return tr('session.live.agentTrace.mS', { p0: m, p1: String(Math.round(s % 60)).padStart(2, '0') })
  return tr('session.live.agentTrace.hM', { p0: Math.floor(m / 60), p1: String(m % 60).padStart(2, '0') })
}

/** 28,470 */
export const formatCount = (n: number): string => Math.round(n).toLocaleString('en-US')

/** claude-sonnet-5-5 → sonnet-5-5 */
export const shortModel = (model: string): string => model.replace(/^claude-/, '')

/** 每个智能体的时间线条在共用时间轴上的位置（百分比） */
export function timeline(agents: AgentRun[], now: number): Map<string, { left: number; width: number }> {
  const timed = agents.filter(a => a.startedAt > 0)
  const bars = new Map<string, { left: number; width: number }>()
  if (timed.length === 0) return bars
  const start = Math.min(...timed.map(a => a.startedAt))
  const end = Math.max(...timed.map(a => a.startedAt + elapsed(a, runState(a.state), now)))
  const span = Math.max(1, end - start)
  for (const a of timed) {
    const left = Math.min(((a.startedAt - start) / span) * 100, 99.2)
    const width = Math.max(0.8, (elapsed(a, runState(a.state), now) / span) * 100)
    bars.set(a.id || a.label, { left, width: Math.min(width, 100 - left) })
  }
  return bars
}

/** 编排的智能体按阶段分组（不在任何阶段里的放最后） */
export function byPhase(run: WorkflowRun): { title: string; agents: AgentRun[] }[] {
  const groups = run.phases.map(p => ({ index: p.index, title: p.title, agents: [] as AgentRun[] }))
  const rest: AgentRun[] = []
  for (const a of run.agents) {
    const g = groups.find(x => x.index === a.phase)
    if (g) g.agents.push(a)
    else rest.push(a)
  }
  const out = groups.filter(g => g.agents.length > 0).map(({ title, agents }) => ({ title, agents }))
  if (rest.length > 0) out.push({ title: '', agents: rest })
  return out
}

/** 编排里完成了几个 / 一共几个 */
export function progress(run: WorkflowRun): { done: number; total: number } {
  const finished = run.agents.filter(a => {
    const s = runState(a.state)
    return s !== 'running' && s !== 'queued'
  })
  return { done: finished.length, total: run.agents.length }
}

export function anyRunning(workflows: WorkflowRun[], agents: AgentRun[]): boolean {
  return workflows.some(w => runState(w.status) === 'running') || agents.some(a => runState(a.state) === 'running')
}
