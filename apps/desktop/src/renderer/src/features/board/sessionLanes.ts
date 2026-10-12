// 会话在任务看板 / 底部运行状态胶囊里算哪一类（docs/ui/task-board.md §2.1、§7）。纯函数，不依赖 window。
// 等你批准 / 出错 / 已暂停直接用「待处理」的结果（含「标记已处理」），三处数字始终一致；
// 剩下的会话里，真在跑的算「运行中」，有新回复没看的算「新回复」（也是在等你）。
import type { ApprovalRequest, QueueSummary, SessionSnapshot, SessionSummary } from '@pixelsky/protocol'
import type { InboxItem } from '@/features/panel/inbox/inboxModel'

export type SessionLane = 'waiting' | 'failed' | 'paused' | 'unread' | 'running'
/** 等你列 / 胶囊列表里的先后：等你处理 > 出错 > 已暂停 > 新回复，最后是运行中 */
export const LANE_ORDER: SessionLane[] = ['waiting', 'failed', 'paused', 'unread', 'running']
export const isWaiting = (lane: SessionLane): boolean => lane !== 'running'

export interface SessionCard {
  id: string
  title: string
  projectId: string | null
  project: string
  /** 会话最近更新时间 */
  at: number
  lane: SessionLane
  /** 等你批准 / 回答：第一个请求；还没读到快照时为 null */
  request: ApprovalRequest | null
  /** 出错：错误摘要 */
  error: string | null
  queue: QueueSummary | null
  /** 运行中：这一轮计划的进度（有计划且读到了快照时） */
  progress: { done: number; total: number } | null
}

/** 真在跑：不空闲也不在等你，或者这一轮说完了但后台子智能体还在跑 */
export const isRunning = (s: SessionSummary): boolean =>
  (s.state !== 'idle' && s.state !== 'waiting') || (s.state === 'idle' && !!s.background)

/** 会话快照里最新的待办清单进度 */
export function progressOf(snapshot: SessionSnapshot | undefined): SessionCard['progress'] {
  const todo = snapshot?.items.findLast(item => item.kind === 'todo')
  if (!todo || todo.kind !== 'todo' || !todo.steps.length) return null
  return { done: todo.steps.filter(s => s.status === 'completed').length, total: todo.steps.length }
}

const order = (a: SessionCard, b: SessionCard): number =>
  LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane) || b.at - a.at

/** 当前机器上要上看板 / 胶囊的会话（sessions 已经按机器筛过）；不含归档、做完看过的 */
export function sessionCards(input: {
  sessions: readonly SessionSummary[]
  snapshots: Readonly<Record<string, SessionSnapshot>>
  projectNames: Readonly<Record<string, string>>
  unread: Readonly<Record<string, boolean>>
  /** 「待处理」的结果（useInbox）：等你批准 / 出错 / 已暂停 */
  inbox: readonly InboxItem[]
}): SessionCard[] {
  const inbox = new Map(input.inbox.map(item => [item.sessionId, item]))
  const cards: SessionCard[] = []
  for (const s of input.sessions) {
    if (s.record.archivedAt) continue
    const id = s.record.id,
      item = inbox.get(id),
      snapshot = input.snapshots[id]
    const lane: SessionLane | null = item ? item.lane : isRunning(s) ? 'running' : input.unread[id] ? 'unread' : null
    if (!lane) continue
    cards.push({
      id,
      title: s.record.title,
      projectId: s.record.projectId,
      project: input.projectNames[s.record.projectId] ?? '',
      at: item?.at ?? s.record.updatedAt,
      lane,
      request: item?.request ?? null,
      error: item?.error ?? null,
      queue: item?.queue ?? s.queue ?? null,
      progress: lane === 'running' ? progressOf(snapshot) : null,
    })
  }
  return cards.sort(order)
}

/** 演示模式：侧栏演示会话的状态（运行中 / 新回复）+ 演示的「待处理」 */
export function demoSessionCards(
  sessions: ReadonlyArray<{
    id: string
    title: string
    status?: 'idle' | 'running' | 'unread'
    projectId: string
    project: string
  }>,
  inbox: readonly InboxItem[],
  now = Date.now(),
): SessionCard[] {
  const fromInbox = new Set(inbox.map(item => item.sessionId))
  const cards: SessionCard[] = inbox.map(item => ({
    id: item.sessionId,
    title: item.title,
    projectId: sessions.find(s => s.id === item.sessionId)?.projectId ?? null,
    project: item.project,
    at: item.at,
    lane: item.lane,
    request: item.request,
    error: item.error,
    queue: item.queue,
    progress: null,
  }))
  sessions.forEach((s, i) => {
    if (!s.status || s.status === 'idle' || fromInbox.has(s.id)) return
    cards.push({
      id: s.id,
      title: s.title,
      projectId: s.projectId,
      project: s.project,
      at: now - (i + 1) * 60_000,
      lane: s.status === 'running' ? 'running' : 'unread',
      request: null,
      error: null,
      queue: null,
      // 演示里只给第一个运行中的会话一个计划进度，其余像没读到快照一样不显示
      progress: s.status === 'running' && !cards.some(c => c.progress) ? { done: 2, total: 5 } : null,
    })
  })
  return cards.sort(order)
}

/** 胶囊上的两个数：运行中、等你 */
export function laneCounts(cards: readonly SessionCard[]): { running: number; waiting: number } {
  const running = cards.filter(c => c.lane === 'running').length
  return { running, waiting: cards.length - running }
}
