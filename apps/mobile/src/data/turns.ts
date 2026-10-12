// 把对话条目按「轮」分组（和桌面端 docs/ui/conversation-concise.md 一样的思路）：
// 每一轮 = 用户消息 + 过程（思考、命令、工具，收成一行「已执行 N 步」）+ 结果（回复、改动文件、待办、提示）。
import type { Item } from '@pixelsky/protocol'

export interface TurnView {
  id: string
  user: Extract<Item, { kind: 'user' }> | null
  /** 过程：思考、命令、工具、压缩 */
  process: Item[]
  /** 按原顺序的结果：回复、改动文件、待办、提示 */
  output: Item[]
  /** 这一轮的统计（用时） */
  stats: Extract<Item, { kind: 'turn_stats' }> | null
}

const PROCESS = new Set<Item['kind']>(['reasoning', 'command', 'tool', 'compaction'])

export function groupTurns(items: readonly Item[]): TurnView[] {
  const turns: TurnView[] = []
  let cur: TurnView | null = null
  for (const item of items) {
    if (item.kind === 'user' || !cur) {
      cur = { id: item.id, user: item.kind === 'user' ? item : null, process: [], output: [], stats: null }
      turns.push(cur)
      if (item.kind === 'user') continue
    }
    if (item.kind === 'turn_stats') cur.stats = item
    else if (PROCESS.has(item.kind)) cur.process.push(item)
    else cur.output.push(item)
  }
  return turns
}

/** 一行摘要里的步数说明：「执行了 3 条命令、读了 2 个文件」这一类太长，手机上只说步数和最后一步 */
export function processSummary(process: readonly Item[]): string {
  const steps = process.filter(i => i.kind !== 'reasoning' || i.text.trim()).length
  return steps ? `已执行 ${steps} 步` : ''
}

/** 一步的简短说明（折叠行和运行中露出的最近几步用） */
export function stepTitle(item: Item): string {
  switch (item.kind) {
    case 'command':
      return item.description || item.command
    case 'tool':
      return item.title ? `${item.name} · ${item.title}` : item.name
    case 'reasoning':
      return '思考'
    case 'compaction':
      return '压缩上下文'
    default:
      return ''
  }
}

/** 一轮用时（统计里有就用） */
export function turnDuration(stats: TurnView['stats']): string {
  const ms = stats?.usage.durationMs
  if (!ms || ms < 1000) return ''
  const s = Math.round(ms / 1000)
  return s < 60 ? `用时 ${s} 秒` : `用时 ${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

/**
 * 「重试」挂在哪条错误上（docs/mobile-remote.md §17 第 4 项，同桌面 LiveTranscript）：
 * 最近一轮（最后一条用户消息之后）的最后一条错误；正在运行、或队列里还有消息（它们有自己的重试）时不给。
 */
export function retryNoticeId(items: readonly Item[], running: boolean, queued: number): string | null {
  if (running || queued > 0) return null
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'user') return null
    if (it.kind === 'notice' && it.level === 'error') return it.id
  }
  return null
}

/** 点「重试」时发的话（同桌面：接着出错前的上下文做） */
export const RETRY_MESSAGE = '继续'
