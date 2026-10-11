// 本机日志：设置 › 日志用（docs/ui/logging.md §4.7）
import type { LogEntry, LogQuery, LogSettings } from '@pixelsky/protocol'

export interface LogBridge {
  /** 按条件读最近的条目（跨重启，从文件读），按时间先后 */
  read(query: LogQuery): Promise<LogEntry[]>
  /** 实时条目；返回取消订阅 */
  onEntry(callback: (entry: LogEntry) => void): () => void
  settings(): Promise<LogSettings>
  /** 打开或关闭详细日志（打开后 24 小时自动关闭） */
  setVerbose(on: boolean): Promise<LogSettings>
  openFolder(): Promise<void>
  /** 弹保存对话框写诊断文件；取消时为 null */
  exportDiagnostics(): Promise<string | null>
  /** 渲染进程报错写进日志（限流） */
  write(level: 'warn' | 'error', message: string, fields?: Record<string, unknown>): void
}
