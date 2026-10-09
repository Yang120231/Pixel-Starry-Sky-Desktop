import type { Effort, FileChange, PermissionMode } from './types'

/** 权限模式，按菜单里的顺序 */
export const PERMISSION_MODES: readonly PermissionMode[] = ['ask', 'edits', 'plan', 'full']

/** 推理强度，从低到高 */
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']

/** 汇总几处改动的增删行数 */
export function diffStat(changes: readonly FileChange[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const c of changes) {
    added += c.added
    removed += c.removed
  }
  return { added, removed }
}

/** 自动压缩触发点可选的百分比（设置 › 本机引擎 › 上下文，docs/ui/engine-settings-redesign.md §3.2） */
export const AUTO_COMPACT_PCTS = [60, 70, 80, 90] as const
