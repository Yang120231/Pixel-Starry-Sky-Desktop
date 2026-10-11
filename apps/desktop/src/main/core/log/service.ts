// 日志服务（docs/ui/logging.md §4）：装进 @pixelsky/engine 的 setLogSink，主进程和引擎包的日志都从这里写。
// 写入前脱敏；同时留最近的条目在内存里，给设置 › 日志实时追加。不依赖 Electron。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatLogLine, type LogEntry, type LogLevel, type LogQuery, type LogSettings } from '@pixelsky/protocol'
import { redact, sanitizeFields, type LogFields, type LogSink } from '@pixelsky/engine'
import { LogFiles, type LogFilesOptions } from './files'

const MAX_MESSAGE = 4000
export const MAX_READ = 1000
/** 详细日志打开多久 */
export const VERBOSE_MS = 24 * 60 * 60_000

export class LogService implements LogSink {
  readonly files: LogFiles
  private readonly now: () => number
  private readonly settingsPath: string
  private verboseUntil: number | null = null
  private readonly listeners = new Set<(entry: LogEntry) => void>()

  constructor(opts: LogFilesOptions) {
    this.files = new LogFiles(opts)
    this.now = opts.now ?? Date.now
    this.settingsPath = join(opts.dir, 'settings.json')
    try {
      const saved = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as { verboseUntil?: unknown }
      if (typeof saved.verboseUntil === 'number' && saved.verboseUntil > this.now())
        this.verboseUntil = saved.verboseUntil
    } catch {
      // 没有设置文件：默认关闭
    }
  }

  enabled(level: LogLevel): boolean {
    if (level !== 'debug') return true
    if (this.verboseUntil === null) return false
    if (this.verboseUntil > this.now()) return true
    this.verboseUntil = null
    return false
  }

  write(level: LogLevel, scope: string, message: string, fields?: LogFields): void {
    if (!this.enabled(level)) return
    let text = redact(message)
    if (text.length > MAX_MESSAGE) text = `${text.slice(0, MAX_MESSAGE)}…`
    const clean = fields ? sanitizeFields(fields) : undefined
    const entry: LogEntry = {
      ts: this.now(),
      level,
      scope,
      message: text,
      ...(clean && Object.keys(clean).length ? { fields: clean } : {}),
    }
    this.files.append(entry.ts, formatLogLine(entry))
    for (const listener of this.listeners) {
      try {
        listener(entry)
      } catch {
        // 订阅方出错不影响写日志
      }
    }
  }

  /** 实时条目；返回取消订阅 */
  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  read(query: LogQuery): Promise<LogEntry[]> {
    const limit = Math.max(1, Math.min(MAX_READ, Math.floor(query.limit ?? MAX_READ)))
    return this.files.read(query, limit)
  }

  settings(): LogSettings {
    this.enabled('debug') // 顺便清掉过期的
    return { dir: this.files.dir, verboseUntil: this.verboseUntil }
  }

  setVerbose(on: boolean): LogSettings {
    this.verboseUntil = on ? this.now() + VERBOSE_MS : null
    try {
      writeFileSync(this.settingsPath, JSON.stringify({ verboseUntil: this.verboseUntil }))
    } catch {
      // 存不下来只影响重启后的状态
    }
    return this.settings()
  }

  flush(): Promise<void> {
    return this.files.flush()
  }

  flushSync(): void {
    this.files.flushSync()
  }
}
