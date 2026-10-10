// 每轮的过程收成一行「执行」（docs/ui/conversation-concise.md §3）：纯函数，LiveTranscript 和测试共用。
// 一直显示：用户消息（含引导）、警告和错误、最后的回复、统计行；其余（思考、工具调用、待办、中间的过渡话、信息提示）是过程。
import type { Item } from '@pixelsky/protocol'

export type Entry =
  | { type: 'item'; item: Item }
  /** running：这一轮还在进行（只有最后一轮可能为真） */
  | { type: 'process'; key: string; items: Item[]; running: boolean; durationMs: number | null }

const isTool = (item: Item): boolean => item.kind === 'command' || item.kind === 'file_change' || item.kind === 'tool'

/** 一直显示的条目（不看位置）：最后的回复另外判断 */
function alwaysVisible(item: Item): boolean {
  if (item.kind === 'user' || item.kind === 'turn_stats') return true
  return item.kind === 'notice' && item.level !== 'info'
}

/** 排在回复后面也不算「回复之后又干了活」的条目：思考（有的模型 / 中转在回复后面还会发一段）、信息提示、只有空白的文字 */
function trailing(item: Item): boolean {
  if (alwaysVisible(item) || item.kind === 'reasoning') return true
  if (item.kind === 'notice') return item.level === 'info'
  return item.kind === 'assistant' && !item.text.trim()
}

/** 一轮里的条目 → 显示顺序：执行块放在第一条过程内容的位置，一直显示的按原来的先后排 */
function foldTurn(turn: Item[], running: boolean): Entry[] {
  // 最后的回复：最后一段有字的助手文字，后面只剩一直显示的内容、思考和信息提示（这些收进执行块）
  let reply = -1
  for (let i = turn.length - 1; i >= 0; i--) {
    const item = turn[i]
    if (item.kind === 'assistant' && item.text.trim()) {
      reply = i
      break
    }
    if (!trailing(item)) break
  }
  const process = turn.filter((item, i) => i !== reply && !alwaysVisible(item))
  // 没有工具调用、只有一条（只有一段思考、一条信息提示）：照原样显示
  if (process.length === 0 || (process.length === 1 && !isTool(process[0])))
    return turn.map(item => ({ type: 'item', item }))
  const stats = turn.find(item => item.kind === 'turn_stats')
  const block: Entry = {
    type: 'process',
    key: `process-${process[0].id}`,
    items: process,
    running,
    durationMs: stats?.kind === 'turn_stats' ? stats.usage.durationMs : null,
  }
  const out: Entry[] = []
  let placed = false
  turn.forEach((item, i) => {
    if (i === reply || alwaysVisible(item)) out.push({ type: 'item', item })
    else if (!placed) {
      out.push(block)
      placed = true
    }
  })
  return out
}

/** running：会话还在进行，最后一轮没结束 */
export function foldTurns(items: readonly Item[], running: boolean): Entry[] {
  const turns: Item[][] = [[]]
  for (const item of items) {
    if (item.kind === 'user' && item.mode !== 'guidance' && turns[turns.length - 1].length > 0) turns.push([])
    turns[turns.length - 1].push(item)
  }
  return turns.flatMap((turn, i) => foldTurn(turn, running && i === turns.length - 1))
}

export interface ProcessSummary {
  commands: number
  /** 改过的文件（同一个文件算一次） */
  edits: number
  reads: number
  searches: number
  web: number
  mcp: number
  agents: number
  other: number
  failed: number
}

export function summarize(items: readonly Item[]): ProcessSummary {
  const s: ProcessSummary = {
    commands: 0,
    edits: 0,
    reads: 0,
    searches: 0,
    web: 0,
    mcp: 0,
    agents: 0,
    other: 0,
    failed: 0,
  }
  const files = new Set<string>()
  for (const item of items) {
    if (item.kind === 'command') s.commands++
    else if (item.kind === 'file_change') item.changes.forEach(c => files.add(c.path))
    else if (item.kind === 'tool') {
      const key = (
        { read: 'reads', search: 'searches', web: 'web', mcp: 'mcp', task: 'agents', other: 'other' } as const
      )[item.tool]
      s[key]++
    }
    if ((item.kind === 'command' || item.kind === 'tool' || item.kind === 'file_change') && item.status === 'failed')
      s.failed++
  }
  s.edits = files.size
  return s
}
