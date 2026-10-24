// 本机通知（docs/mobile-remote.md §15，M4b）：比较前后两次会话列表，找出值得提醒的变化。
// 只看列表（电脑推来的 sessions 事件），不需要打开会话；内容不经第三方，所以可以带任务标题（用户确认）。
import type { SessionSummary } from '@pixelsky/protocol'
import { L } from '@/i18n'
import { taskTitle } from './tasks'

export interface Reminder {
  kind: 'waiting' | 'completed' | 'failed'
  sessionId: string
  title: string
  body: string
}

const busy = (s: SessionSummary | undefined) => s?.state === 'running' || s?.state === 'starting'

/** prev 为 null（刚连上、第一次拿到列表）时不提醒，免得把旧状态当成新消息 */
export function reminders(prev: readonly SessionSummary[] | null, next: readonly SessionSummary[]): Reminder[] {
  if (!prev) return []
  const before = new Map(prev.map(s => [s.record.id, s]))
  const out: Reminder[] = []
  for (const s of next) {
    if (s.record.archivedAt) continue
    const old = before.get(s.record.id)
    const title = taskTitle(s)
    if (s.state === 'waiting' && old?.state !== 'waiting')
      out.push({ kind: 'waiting', sessionId: s.record.id, title: L('等你处理', 'Needs you'), body: title })
    else if (busy(old) && s.state === 'idle') {
      if (s.record.lastOutcome === 'failed')
        out.push({
          kind: 'failed',
          sessionId: s.record.id,
          title: L('任务出错了', 'Task failed'),
          body: s.record.lastError
            ? L(`${title}：${s.record.lastError.slice(0, 80)}`, `${title}: ${s.record.lastError.slice(0, 80)}`)
            : title,
        })
      else if (s.record.lastOutcome === 'completed')
        out.push({ kind: 'completed', sessionId: s.record.id, title: L('任务完成', 'Task completed'), body: title })
    }
  }
  return out
}
