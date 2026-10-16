// 进度卡片里子智能体下面那一行「正在做什么」（docs/ui/progress-card.md §9）：纯函数，ProgressCard、智能体追踪和测试共用。
// 跑着：有摘要写摘要（新摘要来之前一直留着）；没有摘要写最近一步（和对话里工具行的说法一样）；一步都没做写「任务：」。
// 结束：完成 / 失败写结果的第一句，停掉写停下时在做的那一步。工具名（Bash、Read）不直接出现。
import type { AgentRun, Item } from '@pixelsky/protocol'
import { tr } from '../../../i18n/core'
import { runState, type RunState } from './agentTrace'
import { firstLine, stepText } from './currentStep'

/** 子智能体调用的一步（它的工具调用条目，带 subagentCall） */
export type AgentStep = Extract<Item, { kind: 'command' | 'file_change' | 'tool' }>

export type ActivityKind = 'summary' | 'step' | 'task' | 'done' | 'failed' | 'stopped'

export interface Activity {
  kind: ActivityKind
  /** 显示的一行（超长由界面省略） */
  text: string
  /** 悬停时的完整一句（摘要全文、完整命令） */
  full: string
  /** kind 为 step / stopped 时是哪一步（界面据此算「几秒前」） */
  stepId?: string
}

/** 悬停时列出最近几步 */
export const RECENT_STEPS = 3

const isAgentStep = (item: Item): item is AgentStep =>
  (item.kind === 'command' || item.kind === 'file_change' || item.kind === 'tool') && !!item.subagentCall

/** 每个子智能体（按派出它的 Agent 调用 id）调用过的工具，按先后 */
export function agentSteps(items: readonly Item[]): Map<string, AgentStep[]> {
  const out = new Map<string, AgentStep[]>()
  for (const item of items) {
    if (!isAgentStep(item)) continue
    const list = out.get(item.subagentCall!)
    if (list) list.push(item)
    else out.set(item.subagentCall!, [item])
  }
  return out
}

/** 第一句：只看第一行，到第一个句号 / 问号 / 感叹号为止（英文的要后面跟空格，免得把 v1.2、a.ts 切开） */
export function firstSentence(text: string): string {
  const line = firstLine(text)
  const m = /^(.+?[。！？]|.+?[.!?](?=\s))/.exec(line)
  return (m ? m[1] : line).trim()
}

/** 一步的完整说法：命令写完整的第一行，其余同对话里的工具行 */
const stepFull = (step: AgentStep): string =>
  step.kind === 'command' ? tr('session.step.command', { text: firstLine(step.command) }) : stepText(step)

export interface ActivitySource {
  state: RunState
  summary?: string
  result?: string
  task?: string
}

/** 这一行写什么；没什么可写时为 null */
export function agentActivity(agent: ActivitySource, steps: readonly AgentStep[] = []): Activity | null {
  const last = steps.at(-1)
  const summary = agent.summary?.trim()
  switch (agent.state) {
    case 'running':
    case 'queued':
      if (summary) return { kind: 'summary', text: firstLine(summary), full: summary }
      if (last) return { kind: 'step', text: stepText(last), full: stepFull(last), stepId: last.id }
      return taskLine(agent.task)
    case 'done': {
      const result = agent.result?.trim()
      return result
        ? { kind: 'done', text: tr('progressLine.done', { text: firstSentence(result) }), full: result }
        : null
    }
    case 'failed': {
      const result = agent.result?.trim()
      return result
        ? { kind: 'failed', text: tr('progressLine.failed', { text: firstSentence(result) }), full: result }
        : null
    }
    case 'stopped':
      if (last)
        return {
          kind: 'stopped',
          text: tr('progressLine.stoppedAt', { text: stepText(last) }),
          full: tr('progressLine.stoppedAt', { text: stepFull(last) }),
          stepId: last.id,
        }
      return summary
        ? { kind: 'stopped', text: tr('progressLine.stoppedAt', { text: firstLine(summary) }), full: summary }
        : null
  }
}

function taskLine(task: string | undefined): Activity | null {
  const text = task?.trim()
  return text ? { kind: 'task', text: tr('progressLine.task', { text: firstLine(text) }), full: text } : null
}

/** 编排（Workflow）里的智能体：工具调用和进度摘要都传不过来，只有任务说明和结果，按同一套说法 */
export function runActivity(run: Pick<AgentRun, 'state' | 'prompt' | 'result'>): Activity | null {
  const state = runState(run.state)
  if (state === 'running' || state === 'queued') return taskLine(run.prompt)
  return agentActivity({ state, result: run.result })
}

/** 「几秒前」：3 秒内写刚刚，一分钟内写秒，再久写分钟（让人看得出它在等，比如跑很慢的测试） */
export function agoText(ms: number): string {
  if (ms < 3000) return tr('progressLine.justNow')
  if (ms < 60_000) return tr('progressLine.secondsAgo', { n: Math.floor(ms / 1000) })
  return tr('progressLine.minutesAgo', { n: Math.floor(ms / 60_000) })
}

/** 悬停提示：完整的一句，下面再列最近 3 步（最新的在上）；seen 给出每一步第一次看到的时间 */
export function activityTooltip(
  activity: Activity | null,
  steps: readonly AgentStep[],
  seen: (id: string) => number,
  now: number,
): string {
  const recent = steps
    .slice(-RECENT_STEPS)
    .reverse()
    .map(s => `${stepFull(s)} · ${agoText(now - seen(s.id))}`)
  return [activity?.full, ...(recent.length ? [tr('progressLine.recent'), ...recent] : [])].filter(Boolean).join('\n')
}
