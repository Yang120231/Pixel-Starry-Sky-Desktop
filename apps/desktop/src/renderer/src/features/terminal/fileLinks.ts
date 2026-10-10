// 终端路径链接要确认文件存在（docs/ui/files-search-terminal-pins.md §4.2）；查找和缓存与对话共用，见 features/files/pathLinks.ts
import type { TerminalRecord } from '../../../../shared/types/terminal'
import { workspaceFilePath } from '@/features/files/pathLinks'

/** 终端里的一个路径 → 项目内存在的文件的相对路径；不存在、在项目外或解析不了时为 null */
export function terminalFilePath(record: TerminalRecord, raw: string): Promise<string | null> {
  return workspaceFilePath({ projectId: record.projectId }, raw, record.cwd)
}
