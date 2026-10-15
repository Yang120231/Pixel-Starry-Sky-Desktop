// Codex 的回退 / 分叉截断点（docs/ui/rewind-fork-sidechat.md、docs/codex-engine.md）：
// 像素星空发消息时把自己的消息 id 当作 clientUserMessageId 传给 Codex，轮次列表里用户消息带 clientId，据此定位。
// 截断点 at = 最后保留的那一轮的 turn id；null = 一轮都不保留。
import { array, object, string, type CodexProcess } from './process'

/** 一轮：turn id + 这一轮里用户消息的 clientId（按出现顺序） */
export interface CodexTurnInfo {
  id: string
  clientIds: string[]
}

/** 从 thread/turns/list 的一条 turn 提取 id 和用户消息的 clientId */
export function turnInfo(raw: unknown): CodexTurnInfo {
  const turn = object(raw)
  const clientIds: string[] = []
  for (const item of array(turn.items)) {
    const it = object(item)
    if (it.type === 'userMessage' && typeof it.clientId === 'string' && it.clientId) clientIds.push(it.clientId)
  }
  return { id: string(turn.id), clientIds }
}

/**
 * 按被移除的用户消息 id 求截断点：
 * 1. 最早含有被移除消息的那一轮 → at = 它的前一轮（没有前一轮 → null，一轮都不保留）；
 * 2. 被移除的消息都不在记录里，但轮次带 clientId（它们没发到 Codex）→ at = 最后一轮，什么都不删；
 * 3. 记录里没有任何 clientId（不是像素星空发的老会话）或读不到 → null（调用方按「找不到」处理）。
 */
export function codexAnchor(
  turns: readonly CodexTurnInfo[],
  removedIds: readonly string[],
): { at: string | null } | null {
  const removed = new Set(removedIds)
  const index = turns.findIndex(turn => turn.clientIds.some(id => removed.has(id)))
  if (index >= 0) {
    // 同一轮里还有保留的用户消息（turn/steer 把引导追加进了当前轮）：整轮截不开，按「找不到」处理
    if (turns[index].clientIds.some(id => !removed.has(id))) return null
    return { at: index === 0 ? null : turns[index - 1].id }
  }
  if (turns.length > 0 && turns.some(turn => turn.clientIds.length > 0)) return { at: turns[turns.length - 1].id }
  return null
}

/**
 * 回退时传给 thread/revert 的 beforeTurnId：at 的下一轮；at 已是最后一轮返回 null（不用动）；
 * 找不到 at 返回 'missing'
 */
export function revertTarget(turns: readonly CodexTurnInfo[], at: string): string | null | 'missing' {
  const index = turns.findIndex(turn => turn.id === at)
  if (index < 0) return 'missing'
  return turns[index + 1]?.id ?? null
}

/** 翻页读完整个线程的轮次（升序）。冷读：不需要先 resume，不会把线程加载进来 */
export async function readCodexTurns(proc: CodexProcess, threadId: string): Promise<CodexTurnInfo[]> {
  const turns: CodexTurnInfo[] = []
  let cursor: string | null = null
  // 页数上限只是防止异常的游标死循环
  for (let page = 0; page < 1000; page++) {
    const reply: Record<string, unknown> = await proc.request('thread/turns/list', {
      threadId,
      sortDirection: 'asc',
      itemsView: 'full',
      ...(cursor ? { cursor } : {}),
    })
    for (const raw of array(reply.data)) turns.push(turnInfo(raw))
    cursor = typeof reply.nextCursor === 'string' && reply.nextCursor ? reply.nextCursor : null
    if (!cursor) return turns
  }
  throw new Error('Codex turn list did not end')
}
