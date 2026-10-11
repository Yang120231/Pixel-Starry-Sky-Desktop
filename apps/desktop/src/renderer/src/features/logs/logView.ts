// 设置 › 日志的纯函数（docs/ui/logging.md §3.1）：实时追加、模块列表、复制文字、剩余时间
import { formatLogLine, matchesLogQuery, type LogEntry, type LogQuery } from '@pixelsky/protocol'

/** 列表最多留这么多条（和 log:read 的上限一致） */
export const MAX_ENTRIES = 1000

/** 常见模块：下拉里总是列出，读到的其他模块追加在后面 */
const KNOWN_SCOPES = ['app', 'gateway', 'session', 'engine.claude', 'engine.codex', 'renderer', 'crash', 'console']

/** 列表的 key：每条日志一个固定的编号。不能用下标——满 1000 条后每来一条都从头丢一条，下标全变、整个列表重建 */
const keys = new WeakMap<LogEntry, number>()
let nextKey = 0
export function entryKey(entry: LogEntry): number {
  let key = keys.get(entry)
  if (key === undefined) keys.set(entry, (key = nextKey++))
  return key
}

/** 实时条目符合当前条件就追加到末尾，超出上限从最旧的丢 */
export function appendLive(entries: readonly LogEntry[], entry: LogEntry, query: LogQuery): LogEntry[] {
  if (!matchesLogQuery(entry, query)) return entries as LogEntry[]
  const next = [...entries, entry]
  return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next
}

export function scopesOf(entries: readonly LogEntry[], selected: string): string[] {
  const seen = new Set(KNOWN_SCOPES)
  for (const e of entries) if (e.scope !== '-') seen.add(e.scope)
  if (selected) seen.add(selected)
  return [...seen]
}

/** 「复制最近的错误」：最近 50 条警告和错误，日志行格式 */
export function recentProblems(entries: readonly LogEntry[], max = 50): string[] {
  return entries
    .filter(e => e.level === 'warn' || e.level === 'error')
    .slice(-max)
    .map(formatLogLine)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 列表里的时间：今天只显示时分秒，其他日子带月日 */
export function shortTime(ts: number, now: number): string {
  const d = new Date(ts)
  const today = new Date(now)
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return d.toDateString() === today.toDateString() ? clock : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`
}

/** 详细日志还剩多久：[小时, 分钟]，到期为 null */
export function remaining(until: number | null, now: number): [number, number] | null {
  if (until === null || until <= now) return null
  const minutes = Math.ceil((until - now) / 60_000)
  return [Math.floor(minutes / 60), minutes % 60]
}
