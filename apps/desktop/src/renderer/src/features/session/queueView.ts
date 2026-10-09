import type { QueuedMessage } from '@pixelsky/protocol'

/** 空闲时直接发送、正在启动的消息：显示在对话里，不放进消息队列（docs/ui/message-queue.md §2.1）。 */
export function isStarting(q: QueuedMessage, paused: boolean): boolean {
  return !!q.direct && !q.held && !paused && (q.status === 'queued' || q.status === 'dispatching')
}

/** 直接发送却没能开始的消息：仍在队列面板里给出重试 / 撤回，但标为「发送失败」而不是排队。
 *  「待核对」另有含义（可能已交付），保留原标签。 */
export function isSendFailure(q: QueuedMessage): boolean {
  return !!q.direct && q.status === 'failed'
}
