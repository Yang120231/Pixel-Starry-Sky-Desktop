// 对话条目的折叠由 protocol 的 foldTurns 做（两端共用）；这里是手机端显示要用的纯函数：摘要行、时间戳、思考用时、待办进度、重试。
import { diffStat, summarizeProcess } from '@pixelsky/protocol'
import type { Item } from '@pixelsky/protocol'

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
export function turnDuration(stats: Extract<Item, { kind: 'turn_stats' }> | null): string {
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

/** 一段时间说成「N 秒」「M 分 S 秒」 */
function spanText(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

/** 主智能体的步数：命令、工具、改文件（不含子智能体名下的步骤、派出子智能体的调用本身、思考、待办、提示） */
export function stepCount(items: readonly Item[]): number {
  let steps = 0
  for (const i of items) {
    if (i.kind === 'command' || i.kind === 'file_change') {
      if (!i.subagent) steps++
    } else if (i.kind === 'tool' && i.tool !== 'task' && !i.subagent) steps++
  }
  return steps
}

/**
 * 过程摘要行：「做了 3 步 · 改了 2 个文件 +40 −12 · 1 个子智能体 · 1 步失败」。
 * 步数只算主智能体的命令、工具、改文件（不含子智能体名下的步骤、派出子智能体的调用本身、思考、待办、提示）；
 * 子智能体数和失败数取 summarizeProcess，没有可说的返回空串。
 */
export function processLine(items: readonly Item[]): string {
  const steps = stepCount(items)
  const changes = items.flatMap(i => (i.kind === 'file_change' ? i.changes : []))
  const sum = summarizeProcess(items)
  const parts: string[] = []
  if (steps) parts.push(`做了 ${steps} 步`)
  if (sum.edits) {
    const { added, removed } = diffStat(changes)
    parts.push(`改了 ${sum.edits} 个文件 +${added} −${removed}`)
  }
  if (sum.agents) parts.push(`${sum.agents} 个子智能体`)
  if (sum.failed) parts.push(`${sum.failed} 步失败`)
  return parts.join(' · ')
}

const GAP_MS = 5 * 60_000
const pad = (n: number) => String(n).padStart(2, '0')

/** 时间戳文字：今天「14:32」，昨天「昨天 14:32」，今年「10月12日 14:32」，更早带年份 */
export function dividerText(at: number, now: number): string {
  const d = new Date(at)
  const n = new Date(now)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(n) - day(d)) / 86_400_000)
  if (diff === 0) return hm
  if (diff === 1) return `昨天 ${hm}`
  const md = `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
  return d.getFullYear() === n.getFullYear() ? md : `${d.getFullYear()}年${md}`
}

/**
 * 两轮之间的时间：返回「用户消息 id → 文字」，该条消息前面插一个居中时间。
 * 只看非 guidance 的用户消息；上一轮结束 = 上一轮用户消息时间 + 它的用时（没有统计记 0），相差超过 5 分钟才插；已加载的第一轮总插。
 */
export function timeDividers(items: readonly Item[], now: number = Date.now()): Map<string, string> {
  const map = new Map<string, string>()
  let first = true
  let start = 0
  let took = 0
  for (const item of items) {
    if (item.kind === 'turn_stats') took = item.usage.durationMs ?? 0
    else if (item.kind === 'user' && item.mode !== 'guidance') {
      if (first || item.createdAt - (start + took) > GAP_MS) map.set(item.id, dividerText(item.createdAt, now))
      first = false
      start = item.createdAt
      took = 0
    }
  }
  return map
}

// 思考用时：引擎给了 durationMs（Codex）就用它；否则只记手机上亲眼看到在运行的那段（同桌面 ItemRows 的 ReasoningBlock），历史记录、刷新后只写「思考了」
const thinkingStart = new Map<string, number>()
const thinkingTook = new Map<string, number>()

/**
 * 「思考了 4 秒」一类的文字。运行中：不到 1 秒「正在思考」，之后「思考中 N 秒」；
 * 结束后有计时「思考了 N 秒」，没有计时但有文字「思考了」，什么都没有返回 null（不显示）。
 * 会顺带记录开始、结束时间，所以要在渲染时按条目调用。
 */
export function thinkingLabel(item: Extract<Item, { kind: 'reasoning' }>, now: number = Date.now()): string | null {
  const running = item.status === 'running'
  if (running && !thinkingStart.has(item.id)) thinkingStart.set(item.id, now)
  const started = thinkingStart.get(item.id)
  if (!running && started !== undefined && !thinkingTook.has(item.id)) thinkingTook.set(item.id, now - started)
  if (running) {
    const elapsed = started === undefined ? 0 : now - started
    return elapsed >= 1000 ? `思考中 ${spanText(elapsed)}` : '正在思考'
  }
  const took = item.durationMs ?? thinkingTook.get(item.id)
  if (took !== undefined) return `思考了 ${spanText(took)}`
  return item.text.trim() ? '思考了' : null
}

/** 最近一份待办的进度：「计划 3/5」加进行中的那一步；没有待办返回 null */
export function latestTodo(
  items: readonly Item[],
): { done: number; at: number; total: number; current: string | null } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind !== 'todo' || !it.steps.length) continue
    const done = it.steps.filter(s => s.status === 'completed').length
    const current = it.steps.find(s => s.status === 'in_progress')?.text ?? null
    return {
      done,
      // 摘要上写「第几步」：有进行中的那一步时算它（做完 2 步、第 3 步在做 → 3/5），没有就是已完成数
      at: current === null ? done : Math.min(done + 1, it.steps.length),
      total: it.steps.length,
      current,
    }
  }
  return null
}
