// 日志文件（docs/ui/logging.md §4.2）：main-YYYY-MM-DD.log，超过上限换 .1.log、.2.log…；
// 保留 7 天、总量 100 MB。异步追加写入，退出和崩溃时可以同步写完。不依赖 Electron。
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { logTime, matchesLogQuery, parseLogLine, type LogEntry, type LogQuery } from '@pixelsky/protocol'

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

  /** 从新到旧读，取符合条件的最新 limit 条，按时间先后返回 */
  async read(query: LogQuery, limit: number): Promise<LogEntry[]> {
    await this.flush()
    const sinceDay = query.since !== undefined ? dayOf(query.since) : null
    const untilDay = query.until !== undefined ? dayOf(query.until) : null
    const out: LogEntry[] = []
    for (const f of this.list().reverse()) {
      if (sinceDay && f.day < sinceDay) break
      if (untilDay && f.day > untilDay) continue
      let text: string
      try {
        text = await readFile(f.path, 'utf8')
      } catch {
        continue
      }
      const lines = text.split('\n')
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        const entry = parseLogLine(lines[i])
        if (entry && matchesLogQuery(entry, query)) out.push(entry)
      }
      if (out.length >= limit) break
    }
    return out.reverse()
  }
}
