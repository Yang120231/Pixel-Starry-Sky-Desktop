// 任务 › 待处理 的分栏规则（docs/ui/tasks-inbox.md §3）。纯函数，不依赖 window。
import type { ApprovalRequest, ProjectRecord, QueueSummary, SessionSnapshot, SessionSummary } from '@pixelsky/protocol'

export type InboxLane = 'waiting' | 'failed' | 'paused'
export const LANES: InboxLane[] = ['waiting', 'failed', 'paused']

export interface InboxItem {
  sessionId: string
  title: string
  project: string
  lane: InboxLane
  /** 会话最近更新时间 */
  at: number
  /** 等你处理：第一个待批准的请求；还没读到会话快照时为 null */
  request: ApprovalRequest | null
  /** 出错：最近一轮的错误摘要 */
  error: string | null
  queue: QueueSummary | null
  /** 状态签名：「标记已处理」后，签名变了才重新出现 */
  signature: string
}

/** 命令 / 改文件 / 工具类审批可以在待处理里直接允许或拒绝；提问、计划、表单要到会话里处理 */
export function canAnswerInline(request: ApprovalRequest | null): request is ApprovalRequest {
  return (
    !!request &&
    (request.kind === 'command' || request.kind === 'file_change' || request.kind === 'tool') &&
    request.formSchema === undefined &&
    request.canAllow !== false
  )
}

/** 队列暂停且还有没失败的排队消息时可以「继续」 */
export const canResume = (queue: QueueSummary | null): boolean => !!queue?.paused && queue.queued > 0

export function laneOf(summary: SessionSummary): InboxLane | null {
  if (summary.record.archivedAt) return null
  if (summary.state === 'waiting') return 'waiting'
  if (summary.state !== 'idle') return null
  if (summary.record.lastOutcome === 'failed') return 'failed'
  if (summary.queue?.paused && summary.queue.queued + summary.queue.failed > 0) return 'paused'
  return null
}

/** 只用到快照里等你批准的请求（useInbox 传的是 sessionDigest 的摘要） */
type PendingOf = Pick<SessionSnapshot, 'pending'>

export function signatureOf(lane: InboxLane, summary: SessionSummary, snapshot: PendingOf | undefined): string {
  const at = summary.record.updatedAt
  if (lane === 'waiting')
    return 'w:' + (snapshot?.pending.length ? snapshot.pending.map(p => p.requestId).join(',') : at)
  if (lane === 'failed') return 'f:' + at
  return `p:${at}:${(summary.queue?.queued ?? 0) + (summary.queue?.failed ?? 0)}`
}

/**
 * 当前机器上需要你处理的会话：每个会话只出现一次（等你处理 > 出错 > 已暂停），
 * 不含归档和「标记已处理」后状态没变的；同一栏按更新时间倒序。
 */
export function buildInbox(input: {
  sessions: readonly SessionSummary[]
  snapshots: Readonly<Record<string, PendingOf>>
  projects: readonly ProjectRecord[]
  onMachine: (sessionId: string) => boolean
  dismissed: Readonly<Record<string, string>>
}): InboxItem[] {
  const names = new Map(input.projects.map(p => [p.id, p.name]))
  const items: InboxItem[] = []
  for (const summary of input.sessions) {
    const lane = laneOf(summary)
    if (!lane || !input.onMachine(summary.record.id)) continue
    const snapshot = input.snapshots[summary.record.id]
    const signature = signatureOf(lane, summary, snapshot)
    if (input.dismissed[summary.record.id] === signature) continue
    items.push({
      sessionId: summary.record.id,
      title: summary.record.title,
      project: names.get(summary.record.projectId) ?? '',
      lane,
      at: summary.record.updatedAt,
      request: snapshot?.pending[0] ?? null,
      error: summary.record.lastError ?? null,
      queue: summary.queue ?? null,
      signature,
    })
  }
  return items.sort((a, b) => LANES.indexOf(a.lane) - LANES.indexOf(b.lane) || b.at - a.at)
}
