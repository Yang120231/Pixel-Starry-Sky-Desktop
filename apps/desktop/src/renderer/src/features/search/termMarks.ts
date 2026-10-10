// 在页面文字上标出搜索命中（docs/ui/content-highlight.md §2 E）：用 CSS Custom Highlight API（::highlight()），
// 不改 React 结构，对话流里的正文、工具行、用户消息都能标。样式在 globals.css。
//
// 同一种标记（例如 find-match）在整个页面只有一个名字，多个窗格各自登记自己的区间，这里合并后一起设置。
import { matchRanges } from '@pixelsky/protocol'

export type MarkKind = 'search-term' | 'find-match' | 'find-current'

const owners: Record<MarkKind, Map<string, Range[]>> = {
  'search-term': new Map(),
  'find-match': new Map(),
  'find-current': new Map(),
}

const supported = (): boolean => typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'

function apply(kind: MarkKind): void {
  if (!supported()) return
  const ranges = [...owners[kind].values()].flat()
  if (ranges.length === 0) CSS.highlights.delete(kind)
  else CSS.highlights.set(kind, new Highlight(...ranges))
}

/** 登记某个窗格（owner）的一种标记；空数组等于清掉 */
export function setMarks(kind: MarkKind, owner: string, ranges: Range[]): void {
  if (ranges.length === 0) owners[kind].delete(owner)
  else owners[kind].set(owner, ranges)
  apply(kind)
}

/** 不搜的地方：屏幕阅读器用的隐藏副本、公式的 MathML 副本 */
const SKIP = '[aria-hidden="true"],[inert],.katex-mathml,script,style'

/** root 里所有文字节点上的命中（terms 已按 protocol 的规则折叠）。跨节点的命中不算 */
export function findRanges(root: Node, terms: readonly string[]): Range[] {
  if (terms.length === 0 || typeof document === 'undefined') return []
  const out: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => (node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node as Text).data
    if (!text.trim()) continue
    for (const [start, end] of matchRanges(text, terms)) {
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, end)
      out.push(range)
    }
  }
  return out
}
