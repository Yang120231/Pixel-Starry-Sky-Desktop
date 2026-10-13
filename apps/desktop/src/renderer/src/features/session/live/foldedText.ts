// 折叠部分的文字（docs/ui/conversation-ux.md §2.6）：对话内搜索用它数「折叠中还有几处」。
// 和 ItemRows 的显示一一对应：这些文字只有展开以后才在页面上，折叠时 Ctrl+F 在 DOM 里搜不到
import { matchRanges, type Item } from '@pixelsky/protocol'
import { stripAnsi } from '@/ui/code/ansi'
import { foldNotice } from './noticeFold'

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
      // 长提示折着时前几行在页面上，其余的行和报错详情不在
      return [foldNotice(item.text)?.rest ?? '', item.detail?.trim() ?? ''].filter(Boolean).join('\n')
    default:
      return ''
  }
}

/** 整条都不在页面上（收在执行块里，docs/ui/conversation-concise.md §3）时的全部文字 */
export function hiddenText(item: Item): string {
  switch (item.kind) {
    case 'assistant':
    case 'user':
      return item.text
    case 'command':
      return [item.command, stripAnsi(item.output)].join('\n')
    case 'tool':
      return [item.title, stripAnsi(item.output)].join('\n')
    case 'file_change':
      return item.changes.flatMap(c => [c.path, c.diff]).join('\n')
    case 'todo':
      return item.steps.map(s => s.text).join('\n')
    case 'notice':
      return [item.text, item.detail?.trim() ?? ''].join('\n')
    default:
      return foldedText(item)
  }
}

/** closed：当前折叠着的条目 id。返回其中有命中的条目和命中总数（terms 已按 protocol 的规则折叠） */
export function foldedMatches(
  items: readonly Item[],
  terms: readonly string[],
  closed: ReadonlySet<string>,
  /** 整条收在执行块里、不在页面上的条目：算全部文字 */
  hidden: ReadonlySet<string> = new Set(),
): { ids: string[]; count: number } {
  const ids: string[] = []
  let count = 0
  if (terms.length === 0 || (closed.size === 0 && hidden.size === 0)) return { ids, count }
  for (const item of items) {
    const text = hidden.has(item.id) ? hiddenText(item) : closed.has(item.id) ? foldedText(item) : null
    if (text === null) continue
    const n = matchRanges(text, terms).length
    if (n > 0) {
      ids.push(item.id)
      count += n
    }
  }
  return { ids, count }
}
