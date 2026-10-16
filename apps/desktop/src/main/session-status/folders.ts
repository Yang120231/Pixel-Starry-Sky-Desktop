// 工作文件夹还在不在（docs/ui/sidebar-status-icons.md §4）：对所有不同的 cwd 做一次 stat，再按对话归并。
import { stat } from 'node:fs/promises'
import { machineOf } from '../machines/identity'

export interface SessionLite {
  id: string
  cwd: string
  archived: boolean
}

/** 只查本机、没归档、有 cwd 的对话 */
export function localSessions(list: readonly SessionLite[]): SessionLite[] {
  return list.filter(s => !s.archived && s.cwd && machineOf(s.id) === 'local')
}

/** 文件夹在不在：确定不存在（ENOENT / ENOTDIR）才算没了；权限等其它错误当作还在，避免误报 */
export async function folderExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return !(code === 'ENOENT' || code === 'ENOTDIR')
  }
}

/** 找出文件夹没了的对话 */
export async function findMissingFolders(
  sessions: readonly SessionLite[],
  exists: (path: string) => Promise<boolean> = folderExists,
): Promise<Record<string, true>> {
  const cwds = [...new Set(sessions.map(s => s.cwd))]
  const present = new Map<string, boolean>()
  await Promise.all(cwds.map(async cwd => present.set(cwd, await exists(cwd).catch(() => true))))
  const missing: Record<string, true> = {}
  for (const s of sessions) if (present.get(s.cwd) === false) missing[s.id] = true
  return missing
}
