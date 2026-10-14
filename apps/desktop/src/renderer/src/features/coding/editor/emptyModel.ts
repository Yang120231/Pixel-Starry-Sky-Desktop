// 中栏空态「AI 这一轮改的」列表的纯逻辑
import type { TurnFile } from '../ai/turnChangesModel'
import { sortTurnFiles } from '../left/files/filesModel'

export interface EmptyTurnList {
  /** 最多 limit 个，排序同左栏 */
  shown: TurnFile[]
  /** 没列出来的个数 */
  more: number
  /** 排序后的第一个；没有改动时 null */
  first: TurnFile | null
}

export function emptyTurnList(files: readonly TurnFile[] | undefined, limit = 8): EmptyTurnList {
  const sorted = sortTurnFiles(files ?? [])
  const shown = sorted.slice(0, Math.max(0, limit))
  return { shown, more: sorted.length - shown.length, first: sorted[0] ?? null }
}
