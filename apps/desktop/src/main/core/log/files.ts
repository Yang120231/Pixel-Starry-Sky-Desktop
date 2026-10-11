// 日志文件（docs/ui/logging.md §4.2）：main-YYYY-MM-DD.log，超过上限换 .1.log、.2.log…；
// 保留 7 天、总量 100 MB。异步追加写入，退出和崩溃时可以同步写完。不依赖 Electron。
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { appendFile, open } from 'node:fs/promises'
import { join } from 'node:path'
import {
  LOG_LEVEL_RANK,
  logTime,
  matchesLogQuery,
  parseLogLine,
  type LogEntry,
  type LogLevel,
  type LogQuery,
} from '@pixelsky/protocol'

export interface LogFile {
  name: string
  path: string
  /** YYYY-MM-DD（本地日期） */
  day: string
  index: number
  size: number
}

export interface LogFilesOptions {
  dir: string
  maxFileBytes?: number
  keepDays?: number
  maxTotalBytes?: number
  now?: () => number
}

const NAME = /^main-(\d{4}-\d\d-\d\d)(?:\.(\d+))?\.log$/
/** 连续写失败这么多次就停写（磁盘满、没有权限），不影响应用 */
const MAX_FAILURES = 5

const dayOf = (ts: number): string => logTime(ts).slice(0, 10)
const fileName = (day: string, index: number): string => `main-${day}${index ? `.${index}` : ''}.log`

export class LogFiles {
  readonly dir: string
  private readonly maxFileBytes: number
  private readonly keepDays: number
  private readonly maxTotalBytes: number
  private readonly now: () => number
  private queue: { day: string; text: string }[] = []
  private scheduled = false
  private writing: Promise<void> = Promise.resolve()
  private current: { day: string; index: number; size: number } | null = null
  private failures = 0

  constructor(opts: LogFilesOptions) {
    this.dir = opts.dir
    this.maxFileBytes = opts.maxFileBytes ?? 10 * 1024 * 1024
    this.keepDays = opts.keepDays ?? 7
    this.maxTotalBytes = opts.maxTotalBytes ?? 100 * 1024 * 1024
    this.now = opts.now ?? Date.now
    try {
      mkdirSync(this.dir, { recursive: true })
    } catch {
      this.failures = MAX_FAILURES
    }
    this.prune()
  }

  /** 已有的日志文件，从旧到新 */
  list(): LogFile[] {
    let names: string[]
    try {
      names = readdirSync(this.dir)
    } catch {
      return []
    }
    const files: LogFile[] = []
    for (const name of names) {
      const m = NAME.exec(name)
      if (!m) continue
      const path = join(this.dir, name)
      try {
        files.push({ name, path, day: m[1], index: Number(m[2] ?? 0), size: statSync(path).size })
      } catch {
        // 刚被删掉
      }
    }
    return files.sort((a, b) => (a.day === b.day ? a.index - b.index : a.day < b.day ? -1 : 1))
  }

  /** 加一行（不含换行符）；ts 决定写进哪一天的文件 */
  append(ts: number, line: string): void {
    if (this.failures >= MAX_FAILURES) return
    this.queue.push({ day: dayOf(ts), text: line + '\n' })
    if (this.scheduled) return
    this.scheduled = true
    setImmediate(() => {
      this.scheduled = false
      void this.drain()
    })
  }

  /** 把排队的行写完 */
  flush(): Promise<void> {
    return this.drain()
  }

  /** 同步写完（崩溃时用：进程可能马上退出，等不到异步写入） */
  flushSync(): void {
    const batch = this.take()
    for (const [path, text] of batch) {
      try {
        appendFileSync(path, text)
      } catch {
        // 崩溃路径上不再处理
      }
    }
  }

  private drain(): Promise<void> {
    const batch = this.take()
    if (!batch.length) return this.writing
    this.writing = this.writing.then(async () => {
      for (const [path, text] of batch) {
        try {
          await appendFile(path, text)
          this.failures = 0
        } catch {
          this.failures++
        }
      }
    })
    return this.writing
  }

  /** 把队列分到目标文件：按天换文件，超过单文件上限换下一个编号 */
  private take(): [string, string][] {
    const out: [string, string][] = []
    for (const { day, text } of this.queue.splice(0)) {
      const bytes = Buffer.byteLength(text)
      let current = this.current
      if (!current || current.day !== day) {
        current = this.current = this.resume(day)
        if (day === dayOf(this.now())) this.prune()
      }
      if (current.size > 0 && current.size + bytes > this.maxFileBytes) {
        current.index++
        current.size = 0
        this.prune()
      }
      current.size += bytes
      const path = join(this.dir, fileName(day, current.index))
      const last = out[out.length - 1]
      if (last && last[0] === path) last[1] += text
      else out.push([path, text])
    }
    return out
  }

  /** 接着这一天最后一个文件写 */
  private resume(day: string): { day: string; index: number; size: number } {
    const last = this.list()
      .filter(f => f.day === day)
      .at(-1)
    return { day, index: last?.index ?? 0, size: last?.size ?? 0 }
  }

  /** 删掉 keepDays 天前的文件；总量超过上限时从最旧的删起（不删正在写的） */
  prune(): void {
    const files = this.list()
    const oldest = dayOf(this.now() - this.keepDays * 86_400_000)
    const active = this.current ? fileName(this.current.day, this.current.index) : null
    let total = files.reduce((sum, f) => sum + f.size, 0)
    for (const f of files) {
      if (f.name === active) continue
      const expired = f.day < oldest
      const overflow = total > this.maxTotalBytes
      if (!expired && !overflow) continue
      try {
        unlinkSync(f.path)
        total -= f.size
      } catch {
        // 被占用：下次再删
      }
    }
  }

  /**
   * 从新到旧读，取符合条件的最新 limit 条，按时间先后返回。
   * 文件从末尾按块倒着读，够数就停（不筛选时只读最新的一两块）；每块之间让出主进程（docs/ui/performance.md §4）。
   * 先用 roughMatch 在原文上粗筛，可能符合的行才解析。
   */
  async read(query: LogQuery, limit: number): Promise<LogEntry[]> {
    await this.flush()
    const sinceDay = query.since !== undefined ? dayOf(query.since) : null
    const untilDay = query.until !== undefined ? dayOf(query.until) : null
    const rough = roughMatcher(query)
    const out: LogEntry[] = []
    for (const f of this.list().reverse()) {
      if (sinceDay && f.day < sinceDay) break
      if (untilDay && f.day > untilDay) continue
      try {
        for await (const lines of linesFromEnd(f.path)) {
          for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
            if (!rough(lines[i])) continue
            const entry = parseLogLine(lines[i])
            if (entry && matchesLogQuery(entry, query)) out.push(entry)
          }
          if (out.length >= limit) break
        }
      } catch {
        continue
      }
      if (out.length >= limit) break
    }
    return out.reverse()
  }
}

/** 一次倒着读多少字节 */
const CHUNK = 1024 * 1024

/** 从文件末尾按块倒着给出行（每块里的行按原来的先后顺序）；块之间是真正的异步读，主进程可以去做别的 */
export async function* linesFromEnd(path: string, chunk = CHUNK): AsyncGenerator<string[]> {
  const file = await open(path, 'r')
  try {
    let pos = (await file.stat()).size
    let rest: Buffer = Buffer.alloc(0)
    while (pos > 0) {
      const len = Math.min(chunk, pos)
      pos -= len
      const buf = Buffer.allocUnsafe(len)
      await file.read(buf, 0, len, pos)
      const data = rest.length ? Buffer.concat([buf, rest]) : buf
      // 还没读到文件开头：第一个换行之前可能是半行，留给下一块拼上（按字节切，不会切坏 UTF-8）
      const first = pos > 0 ? data.indexOf(0x0a) : -1
      if (pos > 0 && first < 0) {
        rest = data
        continue
      }
      rest = pos > 0 ? data.subarray(0, first) : Buffer.alloc(0)
      yield (pos > 0 ? data.subarray(first + 1) : data).toString('utf8').split('\n')
    }
  } finally {
    await file.close()
  }
}

const LEVEL_OF: Record<string, LogLevel> = { DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error' }
/** 行首的时间（logTime 的格式） */
const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/

/**
 * 在原文上粗筛：明显不符合的行不用解析。只会多放行、不会漏（放行的行还要过 matchesLogQuery）：
 * 级别和模块看行里第二、三个词；搜索词看整行（转义过的反斜杠、换行另说，这时不粗筛）。
 */
export function roughMatcher(query: LogQuery): (line: string) => boolean {
  const min = query.minLevel ? LOG_LEVEL_RANK[query.minLevel] : 0
  const needle = query.text && !/[\\\r\n]/.test(query.text) ? query.text.toLowerCase() : null
  const session = query.sessionId ?? null
  if (!min && !query.scope && !needle && !session) return () => true
  return line => {
    if (min || query.scope) {
      const a = line.indexOf(' ')
      const b = a < 0 ? -1 : line.indexOf(' ', a + 1)
      // 第一个词是时间、第二个是级别才算格式对；格式不对的行解析出来是 info、模块 -（见 parseLogLine）
      let level = b < 0 || !STAMP.test(line) ? undefined : LEVEL_OF[line.slice(a + 1, b)]
      const c = level && query.scope ? line.indexOf(' ', b + 1) : -1
      let scope = level ? line.slice(b + 1, c < 0 ? undefined : c) : '-'
      const reject = (min && LOG_LEVEL_RANK[level ?? 'info'] < min) || (query.scope && scope !== query.scope)
      // 要丢掉之前确认时间真能解析（形状对、日期不对的行也按格式不对算），免得漏掉
      if (reject && level && Number.isNaN(Date.parse(line.slice(0, a)))) {
        level = undefined
        scope = '-'
      }
      if (min && LOG_LEVEL_RANK[level ?? 'info'] < min) return false
      if (query.scope && scope !== query.scope) return false
    }
    if (session && !line.includes(session)) return false
    if (needle && !line.toLowerCase().includes(needle)) return false
    return true
  }
}
