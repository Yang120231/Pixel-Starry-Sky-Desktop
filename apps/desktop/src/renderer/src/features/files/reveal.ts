// 在系统文件管理器里显示项目里的文件（docs/ui/path-click.md §3 2）。
// 只走 files:reveal（shell.showItemInFolder，打开所在文件夹并选中），不会执行文件。
import { isDemo } from '@/data'
import { tr, translateMessage } from '@/i18n/core'
import { machineOf } from '@/features/machines/store'
import type { WorkspaceRef } from '../../../../shared/types/workspace'
import { isAbsolutePath } from './extraFolderPaths'
import { workspacePathOrOutside } from './pathLinks'

/** 远程机器（SSH）上的文件不能在本机文件夹中显示 */
export const isRemoteRef = (ref: WorkspaceRef): boolean => machineOf(ref.sessionId ?? ref.projectId) !== 'local'

/** 悬停提示：单击打开 · 双击在文件夹中显示（远程机器只写单击打开），后面跟完整路径 */
export function pathHint(ref: WorkspaceRef | null | undefined, path: string): string {
  return `${tr(ref && isRemoteRef(ref) ? 'path.hintRemote' : 'path.hint')}\n${path}`
}

/** 失败、远程、演示模式都用 notify 提示，不抛错 */
export async function revealPath(ref: WorkspaceRef, path: string, notify: (message: string) => void): Promise<void> {
  if (isDemo) return notify(tr('path.revealDemo'))
  if (isRemoteRef(ref)) return notify(tr('path.revealRemote'))
  if (!window.pixelsky) return notify(tr('path.revealFailed', { reason: '' }))
  try {
    // 完整路径（AI 改了项目外的文件）：换成项目里的相对路径或「::0/…」（docs/ui/outside-files.md）
    const target = isAbsolutePath(path.replaceAll('\\', '/'))
      ? ((await workspacePathOrOutside(ref, path)) ?? path)
      : path
    await window.pixelsky.files.reveal(ref, target)
  } catch (e) {
    notify(tr('path.revealFailed', { reason: translateMessage((e as Error).message) }))
  }
}
