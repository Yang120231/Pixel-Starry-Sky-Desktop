// 消息队列（docs/mobile-remote.md §17 第 2 项）：哪些放进队列面板、每条显示什么、能做什么。
// 规则和桌面端 features/session/queueView.ts、QueuedMessages.tsx 一样（docs/ui/message-queue.md）。
import type { QueuedMessage, SessionSnapshot } from '@pixelsky/protocol'

/** 空闲时直接发送、正在启动的消息：显示在对话里，不放进队列面板 */
export function isStarting(q: QueuedMessage, paused: boolean): boolean {
  return !!q.direct && !q.held && !paused && (q.status === 'queued' || q.status === 'dispatching')
}

/** 直接发送却没能开始的消息：仍在队列面板里给重试 / 撤回，但标为「发送失败」 */
export const isSendFailure = (q: QueuedMessage): boolean => !!q.direct && q.status === 'failed'

/** 队列面板里要显示的消息（正在执行的在对话里） */
export function queueItems(snapshot: Pick<SessionSnapshot, 'queue' | 'queuePaused'>): QueuedMessage[] {
  return snapshot.queue.filter(q => q.status !== 'running' && !isStarting(q, snapshot.queuePaused))
}

/** 已经在交付，不能撤回 / 插队 */
export const isPending = (q: QueuedMessage): boolean => q.status === 'dispatching' || q.status === 'delivering'

export function queueLabel(q: QueuedMessage): string {
  if (isSendFailure(q)) return '发送失败'
  if (q.status === 'failed') return '执行失败'
  if (q.status === 'uncertain') return '待核对'
  if (q.status === 'delivering') return '等待接收'
  if (q.status === 'dispatching') return '正在启动'
  if (q.held) return '已暂停'
  return '排队中'
}

/** 面板标题：全是发送失败的、暂停了的、普通排队 */
export function queueTitle(items: QueuedMessage[], paused: boolean): string {
  if (items.length && items.every(isSendFailure)) return '发送失败'
  return paused || items.some(q => q.held) ? '队列已暂停' : '排队中'
}

/** 能不能「引导」：这条还在排队，引擎支持运行中引导，当前有一轮在跑（设置是否一致由电脑判断） */
export function canSteer(q: QueuedMessage, snapshot: Pick<SessionSnapshot, 'state' | 'turnId' | 'flags'>): boolean {
  return (
    q.status === 'queued' && snapshot.flags.steerAvailable === true && snapshot.state === 'running' && !!snapshot.turnId
  )
}
