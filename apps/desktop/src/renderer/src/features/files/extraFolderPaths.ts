// 多文件夹项目的路径（docs/ui/multi-root-projects.md §3.4）：「::N/…」是第 N 个附加文件夹里的路径。纯函数，界面和测试共用
import type { ProjectFolder } from '@pixelsky/protocol'
import { projectPath } from './pathMatch'

const EXTRA = /^::(\d{1,2})(?:\/|$)/

/** 「::0/完整路径」：项目外的文件（docs/ui/outside-files.md），编号 0 不会和附加文件夹（1–20）撞上 */
export const OUTSIDE_PREFIX = '::0/'

/** 拆出附加文件夹编号（从 1 开始，项目外为 0）和文件夹里的相对路径；主文件夹里的路径 index 为 null */
export function splitExtra(path: string): { index: number | null; prefix: string; rest: string } {
  const match = EXTRA.exec(path)
  if (!match) return { index: null, prefix: '', rest: path }
  return { index: Number(match[1]), prefix: `::${match[1]}`, rest: path.slice(match[0].length) }
}

export const folderLabel = (folder: ProjectFolder): string =>
  folder.name || folder.path.split(/[\\/]/).filter(Boolean).pop() || folder.path

/** 盘符开头或 / 开头的绝对路径（已经换成 /） */
export const isAbsolutePath = (path: string): boolean => /^[A-Za-z]:\//.test(path) || path.startsWith('/')

/**
 * 绝对路径 → 主文件夹的相对路径，或附加文件夹里的「::N/相对路径」；都不在时 null。
 * 主文件夹优先（附加文件夹恰好在主文件夹里面时按主文件夹算）
 */
export function relativeInFolders(
  absolute: string,
  target: { path: string; folders?: readonly { path: string }[] },
  windows: boolean,
): string | null {
  const main = projectPath(absolute, target.path, target.path, windows)
  if (main) return main
  for (const [i, folder] of (target.folders ?? []).entries()) {
    const relative = projectPath(absolute, folder.path, folder.path, windows)
    if (relative) return `::${i + 1}/${relative}`
  }
  return null
}
