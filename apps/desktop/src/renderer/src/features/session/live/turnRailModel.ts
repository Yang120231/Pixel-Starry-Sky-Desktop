// 轮次跳转条（docs/ui/turn-rail.md）：轮次列表、刻度抽样、当前轮。纯函数
import type { Item } from '@pixelsky/protocol'

export interface Turn {
  id: string
  /** 第几轮，从 1 开始 */
  n: number
  /** 我方消息的第一行，最多 60 字；纯图片消息为空 */
  preview: string
}

/** 每条正常发出的我方消息算一轮（运行中插话的引导消息不算） */
export function turnsOf(items: readonly Item[]): Turn[] {
  const turns: Turn[] = []
  for (const item of items) {
    if (item.kind !== 'user' || item.mode === 'guidance') continue
    const line = item.text.trim().split('\n')[0]?.trim() ?? ''
    turns.push({ id: item.id, n: turns.length + 1, preview: line.length > 60 ? `${line.slice(0, 60)}…` : line })
  }
  return turns
}

/** 放得下的刻度数：间距最小 3px */
export function maxTicks(height: number, minGap = 3): number {
  return Math.max(2, Math.floor(height / minGap))
}

/** 刻度太多时按比例抽样：保留第一轮、最后一轮和当前轮，返回要画的轮次下标（升序） */
export function sampleTurns(count: number, limit: number, current: number): number[] {
  if (count <= limit) return Array.from({ length: count }, (_, i) => i)
  const picked = new Set<number>([0, count - 1])
  if (current >= 0 && current < count) picked.add(current)
  const slots = limit - picked.size
  for (let k = 1; k <= slots; k++) picked.add(Math.round((k * (count - 1)) / (slots + 1)))
  return [...picked].sort((a, b) => a - b)
}

/** 当前轮：顶部已经滚过（或接近）视口顶部的最后一轮；都还在下面时是第一轮 */
export function currentTurn(tops: readonly number[], viewTop: number, slack = 48): number {
  let current = 0
  for (let i = 0; i < tops.length; i++) if (tops[i] <= viewTop + slack) current = i
  return current
}
