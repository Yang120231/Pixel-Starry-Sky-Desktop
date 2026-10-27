// 本机目录监听推来的一次变化要怎么刷新文件树（docs/ui/file-tree-auto-refresh.md §2 B）
import type { TreeChange } from '../../../../shared/types/workspace'
import { isIgnoredPath } from './ignored'

/** 路径所在的文件夹（树里的写法）：'a/b.txt' → 'a'，'b.txt' → ''，'::1/x' → '::1'；根目录自己返回 null */
export function parentDir(path: string, prefix: string): string | null {
  if (path === prefix) return null
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

/**
 * 一次监听变化要做什么：all 整棵重读；dirs 只重读这些文件夹（没展开的不会读）；status 要不要重读 Git 状态。
 * 被忽略的路径（node_modules 这类）不触发 Git 状态重读，文件夹照样重读（展开着就是在看）
 */
export function planTreeChange(
  change: TreeChange,
  ignored: ReadonlySet<string>,
  prefixes: readonly string[],
): { all: boolean; dirs: string[]; status: boolean } {
  if (change.overflow) return { all: true, dirs: [], status: true }
  const dirs = new Set<string>()
  let all = false
  for (const path of change.added) {
    const prefix = prefixes.find(p => p && (path === p || path.startsWith(p + '/'))) ?? ''
    const dir = parentDir(path, prefix)
    if (dir === null) all = true
    else dirs.add(dir)
  }
  const status = change.git || [...change.added, ...change.changed].some(path => !isIgnoredPath(path, ignored))
  return { all, dirs: [...dirs], status }
}
