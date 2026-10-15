// 反馈页的视图逻辑（docs/ui/feedback-v2.md §4）：状态文字、进度条步骤、「新回复」分隔线位置、列表筛选搜索。纯函数，直接单测。
import type {
  FeedbackMessage,
  FeedbackStatus,
  FeedbackSummary,
  FeedbackThread,
  FeedbackType,
} from '../../../../shared/types/feedback'

/** 列表和详情共用的状态文字：closed 已关闭 / replied 已回复 / working 团队处理中 / seen 团队已看到 / waiting 等待回复 */
export type StatusKind = 'closed' | 'replied' | 'working' | 'seen' | 'waiting'

export function statusKind(t: Pick<FeedbackSummary, 'status' | 'working' | 'teamSeen'>): StatusKind {
  if (t.status === 'closed') return 'closed'
  if (t.status === 'replied') return 'replied'
  if (t.working) return 'working'
  if (t.teamSeen) return 'seen'
  return 'waiting'
}

export type StepKey = 'submitted' | 'seen' | 'working' | 'replied' | 'resolved'
export const STEP_ORDER: readonly StepKey[] = ['submitted', 'seen', 'working', 'replied', 'resolved']

export interface ProgressStep {
  key: StepKey
  /** done 走到了；todo 没走到（空心） */
  state: 'done' | 'todo'
  /** 这一步有自己的时间才写；跳过的步骤是 done 但没有时间 */
  at: number | null
}

/**
 * 五步进度：已提交 → 团队已看到 → 处理中 → 已回复 → 已解决。
 * 后面的步骤走到了，前面没有证据的步骤也算完成（比如没认领就回复了），只是不写时间。
 */
export function progressSteps(
  thread: Pick<
    FeedbackThread,
    'createdAt' | 'status' | 'teamSeen' | 'teamSeenAt' | 'working' | 'workingAt' | 'closedAt'
  >,
  messages: readonly Pick<FeedbackMessage, 'author' | 'kind' | 'createdAt'>[],
): ProgressStep[] {
  const firstTeam = messages.find(m => m.author === 'team' && m.kind === 'message')
  const own: Record<StepKey, { reached: boolean; at: number | null }> = {
    submitted: { reached: true, at: thread.createdAt || null },
    seen: { reached: thread.teamSeen, at: thread.teamSeenAt },
    working: { reached: thread.working, at: thread.workingAt },
    replied: { reached: !!firstTeam, at: firstTeam?.createdAt ?? null },
    resolved: { reached: thread.status === 'closed', at: thread.closedAt },
  }
  let last = 0
  STEP_ORDER.forEach((key, i) => {
    if (own[key].reached) last = i
  })
  // 团队已看到、处理中的时间是「最近一次」：之后团队再回复、转交会往后挪，比后面的步骤还晚。
  // 进度条上每步的时间不晚于后面走到的步骤（到那一步时这一步肯定已经发生了）
  const at = STEP_ORDER.map(key => (own[key].reached ? own[key].at : null))
  let floor = Infinity
  for (let i = at.length - 1; i >= 0; i--) {
    const t = at[i]
    if (t == null) continue
    at[i] = Math.min(t, floor)
    floor = at[i]!
  }
  return STEP_ORDER.map((key, i) => ({ key, state: i <= last ? 'done' : 'todo', at: at[i] }))
}

/**
 * 「新回复」分隔线画在哪条消息前面：这条反馈未读时，在最后一条用户消息之后的第一条团队消息前。
 * 返回那条消息在 messages 里的下标；不需要画返回 -1。
 */
export function newReplyIndex(messages: readonly Pick<FeedbackMessage, 'author' | 'kind'>[], unread: boolean): number {
  if (!unread) return -1
  let lastUser = -1
  messages.forEach((m, i) => {
    if (m.kind === 'message' && m.author === 'user') lastUser = i
  })
  return messages.findIndex((m, i) => i > lastUser && m.kind === 'message' && m.author === 'team')
}

/** 列表状态分段：进行中（没关闭）/ 已关闭 / 全部 */
export type Segment = 'active' | 'closed' | 'all'
export type TypeFilter = 'all' | FeedbackType

const inSegment = (status: FeedbackStatus, segment: Segment): boolean =>
  segment === 'all' || (segment === 'closed') === (status === 'closed')

export function segmentCounts(threads: readonly Pick<FeedbackSummary, 'status'>[]): Record<Segment, number> {
  const closed = threads.filter(t => t.status === 'closed').length
  return { active: threads.length - closed, closed, all: threads.length }
}

/** 本地过滤：状态分段 + 类型 + 搜索（标题和预览，不分大小写，空格分词都要命中） */
export function filterThreads(
  threads: readonly FeedbackSummary[],
  opts: { segment: Segment; type: TypeFilter; query: string },
): FeedbackSummary[] {
  const words = opts.query.toLowerCase().split(/\s+/).filter(Boolean)
  return threads.filter(t => {
    if (!inSegment(t.status, opts.segment)) return false
    if (opts.type !== 'all' && t.type !== opts.type) return false
    if (!words.length) return true
    const hay = `${t.title}\n${t.preview}`.toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

/** 列表元信息里的 ID 前几位（fb_ 后 6 位） */
export const shortId = (id: string): string => `#${id.replace(/^fb_/, '').slice(0, 6)}`

/** 未读数角标：超过 9 显示 9+ */
export const badgeText = (count: number): string => (count > 9 ? '9+' : String(count))

/** 表单里「第一次点提交后才显示红字」的逐项错误 */
export interface FieldErrors {
  title: 'titleEmpty' | 'titleLong' | null
  body: 'bodyEmpty' | 'bodyLong' | null
}

export function fieldErrors(input: {
  title: string
  body: string
  composed: string
  titleMax: number
  bodyMax: number
}): FieldErrors {
  const title = input.title.trim()
  return {
    title: !title ? 'titleEmpty' : [...title].length > input.titleMax ? 'titleLong' : null,
    body: !input.body.trim() ? 'bodyEmpty' : [...input.composed].length > input.bodyMax ? 'bodyLong' : null,
  }
}
