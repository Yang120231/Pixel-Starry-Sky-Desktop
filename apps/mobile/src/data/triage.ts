// 点「有 N 个任务等你处理」的通知后逐个处理（docs/mobile-remote.md §25）：打开时记下等你的会话，处理完（或跳过）一个就去下一个
// 还在等你的；都过完了显示「都处理完了」。纯函数在这里测（triage.test.ts），页面切换在 App。
import type { SessionSummary } from '@pixelsky/protocol'
import { groupTasks } from './tasks'

export interface Triage {
  /** 打开时等你处理的会话，按首页的顺序 */
  ids: string[]
}

/** 现在等你处理的会话：没有时返回 null（都在电脑上处理过了） */
export function startTriage(sessions: SessionSummary[]): Triage | null {
  const ids = groupTasks(sessions).waiting.map(s => s.record.id)
  return ids.length ? { ids } : null
}

/** current 之后还在等你的下一个；没有了返回 null。电脑上已经处理掉、归档了的跳过 */
export function nextInTriage(triage: Triage, current: string, sessions: SessionSummary[]): string | null {
  const waiting = new Set(groupTasks(sessions).waiting.map(s => s.record.id))
  const from = triage.ids.indexOf(current)
  return triage.ids.slice(from + 1).find(id => waiting.has(id)) ?? null
}

/** 顶部「等你处理 2 / 3」：第几个（从 1 数）和一共几个；不在这一批里返回 null */
export function triagePosition(triage: Triage, current: string): { index: number; total: number } | null {
  const i = triage.ids.indexOf(current)
  return i < 0 ? null : { index: i + 1, total: triage.ids.length }
}
