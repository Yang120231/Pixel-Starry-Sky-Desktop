// 进度卡片的数据（docs/ui/progress-card.md §2、§3）：当前计划、子智能体行、这一轮的 key
import type { AgentRuns, Item, SubagentStatus, TodoStep } from '@pixelsky/protocol'
import { runState, type RunState } from './agentTrace'

export interface Plan {
  id: string
  steps: TodoStep[]
  done: number
}

export interface ProgressAgent {
  id: string
  label: string
  state: RunState
  model: string
  type: string
  message: string | null
  startedAt: number
  durationMs: number
  /** 后台子智能体（只有它们能单独停） */
  background: boolean
}

const isTurnStart = (item: Item): boolean => item.kind === 'user' && item.mode !== 'guidance'

/** 最近一轮的 key：最后一条非引导用户消息的 id（还没有时为空字符串） */
export function turnKey(items: Item[]): string {
  for (let i = items.length - 1; i >= 0; i--) if (isTurnStart(items[i])) return items[i].id
  return ''
}

/** 要显示的计划：最新一条待办，属于最近一轮，或会话还在运行且没全部完成；否则 null */
export function currentPlan(items: Item[], running: boolean): Plan | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind !== 'todo' || item.steps.length === 0) continue
    const done = item.steps.filter(s => s.status === 'completed').length
    const inLatestTurn = !items.slice(i + 1).some(isTurnStart)
    if (inLatestTurn || (running && done < item.steps.length)) return { id: item.id, steps: item.steps, done }
    return null
  }
  return null
}

/** 子智能体条的状态和进度，按 id 合并追踪里的模型、类型和时间 */
export function progressAgents(subagents: SubagentStatus[], runs: AgentRuns | undefined): ProgressAgent[] {
  const byId = new Map((runs?.agents ?? []).filter(a => a.id).map(a => [a.id, a]))
  return subagents.map(a => {
    const run = byId.get(a.id)
    return {
      id: a.id,
      label: a.label || run?.label || a.id.slice(0, 8),
      state: runState(a.status),
      model: run?.model ?? '',
      type: run?.type ?? '',
      message: a.message,
      startedAt: run?.startedAt ?? 0,
      durationMs: run?.durationMs ?? 0,
      background: a.background === true,
    }
  })
}

/** 当前步骤（进行中的第一个）的下标；没有时 -1 */
export const activeStep = (steps: TodoStep[]): number => steps.findIndex(s => s.status === 'in_progress')
