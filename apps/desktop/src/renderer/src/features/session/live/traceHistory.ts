// 智能体追踪的历史分类（docs/ui/trace-history.md §3）：正在跑 / 需要看一眼 / 历史，纯函数，不碰存储
import type { AgentRun, AgentRuns, Item, WorkflowRun } from '@pixelsky/protocol'
import { tr } from '../../../i18n/core'
import { runState } from './agentTrace'

export type TraceEntry = { kind: 'workflow'; run: WorkflowRun } | { kind: 'agent'; run: AgentRun }

export interface PartitionOptions {
  now: number
  /** 看过的 id（编排 w.id，子智能体 a.id） */
  seen: ReadonlySet<string>
  /** 清空时间点；null = 没清空 */
  clearedAt: number | null
  onlyTurn: boolean
  turnToolUseIds: ReadonlySet<string>
}

export interface TracePartition {
  /** runState 为 running / queued（含没有 id 的排队项），保持原顺序 */
  running: { workflows: WorkflowRun[]; agents: AgentRun[] }
  /** failed / stopped、有 id、没看过；不受清空、只看这一轮影响；按结束时间新→旧 */
  attention: TraceEntry[]
  /** 其余已结束的，已去掉清空的、（onlyTurn 时）不是这一轮的；按结束时间新→旧 */
  history: TraceEntry[]
  /** 因为 clearedAt 被藏起来的条数（不管 onlyTurn） */
  clearedCount: number
  /** 全部编排 + 子智能体 tokens 合计（清空不影响） */
  totalTokens: number
}

/** 结束时间：开始 + 用时；用时不大于 0 时就是开始时间 */
export function endedAt(run: { startedAt: number; durationMs: number }): number {
  return run.durationMs > 0 ? run.startedAt + run.durationMs : run.startedAt
}

export function partitionRuns(runs: AgentRuns, opts: PartitionOptions): TracePartition {
  const running: TracePartition['running'] = { workflows: [], agents: [] }
  const attention: TraceEntry[] = []
  const history: TraceEntry[] = []
  let clearedCount = 0
  let totalTokens = 0

  const place = (entry: TraceEntry): void => {
    const { run } = entry
    const state = runState(entry.kind === 'workflow' ? entry.run.status : entry.run.state)
    if (state === 'running' || state === 'queued') {
      if (entry.kind === 'workflow') running.workflows.push(entry.run)
      else running.agents.push(entry.run)
      return
    }
    if ((state === 'failed' || state === 'stopped') && run.id && !opts.seen.has(run.id)) {
      attention.push(entry)
      return
    }
    if (opts.clearedAt !== null && endedAt(run) <= opts.clearedAt) {
      clearedCount++
      return
    }
    if (opts.onlyTurn && (run.toolUseId === null || !opts.turnToolUseIds.has(run.toolUseId))) return
    history.push(entry)
  }

  for (const w of runs.workflows) {
    totalTokens += w.tokens
    place({ kind: 'workflow', run: w })
  }
  for (const a of runs.agents) {
    totalTokens += a.tokens
    place({ kind: 'agent', run: a })
  }

  const byEnd = (a: TraceEntry, b: TraceEntry): number => endedAt(b.run) - endedAt(a.run)
  attention.sort(byEnd)
  history.sort(byEnd)
  return { running, attention, history, clearedCount, totalTokens }
}

/** 最后一条「非引导」用户消息之后出现的工具调用 id（Item.id 就是工具调用 id）；没有用户消息时 = 全部 */
export function turnToolUseIds(items: readonly Item[]): Set<string> {
  let start = 0
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'user' && it.mode !== 'guidance') {
      start = i + 1
      break
    }
  }
  const ids = new Set<string>()
  for (let i = start; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'tool' || it.kind === 'command' || it.kind === 'file_change') ids.add(it.id)
  }
  return ids
}

/** 历史行右边的「N 分钟前」 */
export function ago(at: number, now: number): string {
  const s = Math.max(0, (now - at) / 1000)
  if (s < 60) return tr('trace.history.agoNow')
  if (s < 3600) return tr('trace.history.agoMinutes', { n: Math.floor(s / 60) })
  if (s < 86400) return tr('trace.history.agoHours', { n: Math.floor(s / 3600) })
  return tr('trace.history.agoDays', { n: Math.floor(s / 86400) })
}
