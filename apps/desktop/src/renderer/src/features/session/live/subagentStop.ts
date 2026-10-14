// 停止主智能体时连同后台子智能体（docs/ui/subagent-stop.md）
import { backgroundAgents, ENGINES, type BackgroundAgentRef, type Item, type SessionSnapshot } from '@pixelsky/protocol'

/** 还在跑的后台子智能体和编排；引擎没有后台任务能力时为空 */
export function stopTargets(snapshot: SessionSnapshot | null): BackgroundAgentRef[] {
  if (!snapshot || !ENGINES[snapshot.record.engine].caps.backgroundTasks) return []
  return backgroundAgents(snapshot.subagents, snapshot.tasks)
}

/** 最近一轮（最后一条非引导的用户消息之后）是被中断结束的 */
export function lastTurnInterrupted(items: Item[]): boolean {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'turn_stats') return it.outcome === 'interrupted'
    if (it.kind === 'user' && it.mode !== 'guidance') return false
  }
  return false
}

/** 保留模式：主智能体停了、后台子智能体还在跑（输入框上方的提醒） */
export function keptAgents(snapshot: SessionSnapshot | null): BackgroundAgentRef[] {
  if (!snapshot || snapshot.state !== 'idle' || !lastTurnInterrupted(snapshot.items)) return []
  return stopTargets(snapshot)
}
