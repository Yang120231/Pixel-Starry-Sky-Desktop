import type { BackgroundTask, SubagentStatus } from './types'

export interface BackgroundAgentRef {
  id: string
  label: string
  kind: 'agent' | 'workflow'
}

/** 还在跑的后台子智能体和编排：子智能体条里 background 且 running 的，加上后台任务里 local_agent* / local_workflow* 的；按 id 去重，名字优先用子智能体条的 */
export function backgroundAgents(subagents: SubagentStatus[], tasks: BackgroundTask[]): BackgroundAgentRef[] {
  const out = new Map<string, BackgroundAgentRef>()
  for (const a of subagents) {
    if (a.status !== 'running' || !a.background) continue
    out.set(a.id, { id: a.id, label: a.label || a.id.slice(0, 8), kind: 'agent' })
  }
  for (const t of tasks) {
    const agent = t.kind.startsWith('local_agent')
    const workflow = t.kind.startsWith('local_workflow')
    if (!agent && !workflow) continue
    const have = out.get(t.id)
    if (have) continue
    out.set(t.id, { id: t.id, label: t.description || t.id.slice(0, 8), kind: workflow ? 'workflow' : 'agent' })
  }
  return [...out.values()]
}
