import type { SettingsSyncReply } from '../shared/types/settings-sync'

/** 设置云同步（docs/ui/settings-sync.md §5.1） */
export interface SettingsSyncBridge {
  pull(): Promise<SettingsSyncReply>
  /** 值为 null 表示删掉云端的这个键 */
  push(changes: Record<string, unknown>): Promise<SettingsSyncReply>
  /** 本机引擎设置里可以同步的几项（不含命令路径、参数、环境变量） */
  engine(): Promise<Record<string, unknown> | null>
  applyEngine(key: string, value: unknown): Promise<Record<string, unknown> | null>
}
