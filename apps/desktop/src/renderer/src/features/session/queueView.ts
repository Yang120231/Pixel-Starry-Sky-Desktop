import type { QueuedMessage } from '@pixelsky/protocol'

/** 空闲时直接发送、正在启动的消息：显示在对话里，不放进消息队列（docs/ui/message-queue.md §2.1）。 */
export function isStarting(q: QueuedMessage, paused: boolean): boolean {
  return !!q.direct && !q.held && !paused && !q.reconnect && (q.status === 'queued' || q.status === 'dispatching')
}

/** 断线后正在自动重连的那条：显示重连卡片（ReconnectStatus），不放进消息队列。
 *  单独暂停（held）的留在队列里等「继续队列」，不算重连中 */
export function isReconnecting(q: QueuedMessage): boolean {
  return !!q.reconnect && !q.held && (q.status === 'queued' || q.status === 'dispatching')
}

/** 到点后过了这么久还是排队、没开始派发：宿主那边没排上（会话忙、锁住等），卡片不再装作「正在连接」 */
const STALLED_MS = 3000

export type ReconnectPhase = 'waiting' | 'connecting' | 'paused' | 'stalled'

/** 重连卡片处在哪个阶段：倒计时中 / 正在连接 / 队列暂停 / 到点却没动静。调用方保证 q 是 isReconnecting 的 */
export function reconnectPhase(q: QueuedMessage, paused: boolean, now: number): ReconnectPhase {
  if (paused) return 'paused'
  if (q.status === 'dispatching') return 'connecting'
  const at = q.reconnect?.at ?? Infinity
  if (now < at) return 'waiting'
  return now - at > STALLED_MS ? 'stalled' : 'connecting'
}

/** 失败的这条已经在对话里：可以「关掉」，不重发也不撤回 */
export function canDismiss(q: QueuedMessage): boolean {
  return (q.status === 'failed' || q.status === 'uncertain') && !!q.messageUuid
}

/** 直接发送却没能开始的消息：仍在队列面板里给出重试 / 撤回，但标为「发送失败」而不是排队。
 *  「待核对」另有含义（可能已交付），保留原标签。 */
export function isSendFailure(q: QueuedMessage): boolean {
  return !!q.direct && q.status === 'failed'
}
