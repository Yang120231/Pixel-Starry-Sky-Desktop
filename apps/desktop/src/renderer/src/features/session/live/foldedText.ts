// 折叠部分的文字（docs/ui/conversation-ux.md §2.6）：对话内搜索用它数「折叠中还有几处」。
// 和 ItemRows 的显示一一对应：这些文字只有展开以后才在页面上，折叠时 Ctrl+F 在 DOM 里搜不到
import { matchRanges, type Item } from '@pixelsky/protocol'
import { stripAnsi } from '@/ui/code/ansi'

export function foldedText(item: Item): string {
  switch (item.kind) {
    case 'command':
      return stripAnsi(item.output)
    case 'tool':
      return stripAnsi(item.output)
    case 'file_change':
      return item.changes.map(c => c.diff).join('\n')
    case 'reasoning':
      return item.text
    case 'todo': {
      // 进行中的那一步折叠时也显示在概要里，不算折叠部分
      const current = item.steps.find(s => s.status === 'in_progress')
      return item.steps
        .filter(s => s !== current)
        .map(s => s.text)
        .join('\n')
    }
    case 'notice':
      return item.detail?.trim() ?? ''
    default:
      return ''
  }
}

/** closed：当前折叠着的条目 id。返回其中有命中的条目和命中总数（terms 已按 protocol 的规则折叠） */
export function foldedMatches(
  items: readonly Item[],
  terms: readonly string[],
  closed: ReadonlySet<string>,
): { ids: string[]; count: number } {
  const ids: string[] = []
  let count = 0
  if (terms.length === 0 || closed.size === 0) return { ids, count }
  for (const item of items) {
    if (!closed.has(item.id)) continue
    const n = matchRanges(foldedText(item), terms).length
    if (n > 0) {
      ids.push(item.id)
      count += n
    }
  }
  return { ids, count }
}
