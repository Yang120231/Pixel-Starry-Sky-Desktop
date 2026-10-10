// 在页面文字上标出搜索命中（docs/ui/content-highlight.md §2 E）：用 CSS Custom Highlight API（::highlight()），
// 不改 React 结构，对话流里的正文、工具行、用户消息都能标。样式在 globals.css。
//
// 同一种标记（例如 find-match）在整个页面只有一个名字，多个窗格各自登记自己的区间，这里合并后一起设置。
import { matchRanges } from '@pixelsky/protocol'
import { joinRuns, locate, type TextPiece } from './textRuns'

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

/** 行内元素：里面的文字和前后连成一段（代码着色、加粗、行内代码都不打断一个词） */
const INLINE = new Set([
  'A',
  'ABBR',
  'B',
  'CITE',
  'CODE',
  'DEL',
  'DFN',
  'EM',
  'I',
  'INS',
  'KBD',
  'MARK',
  'Q',
  'S',
  'SAMP',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUP',
  'TIME',
  'U',
  'VAR',
])

function blockOf(node: Node, root: Node): Node {
  let el = node.parentElement
  while (el && el !== root && INLINE.has(el.tagName)) el = el.parentElement
  return el ?? root
}

/**
 * root 里文字上的命中（terms 已按 protocol 的规则折叠）。同一个块里相邻的文字节点连起来找，
 * 被代码着色拆开的词也能找到（docs/ui/workbench-ux-3.md §2.7）
 */
export function findRanges(root: Node, terms: readonly string[]): Range[] {
  if (terms.length === 0 || typeof document === 'undefined') return []
  const pieces: TextPiece<Text>[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => (node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    pieces.push({ node: node as Text, block: blockOf(node, root), text: (node as Text).data })
  const out: Range[] = []
  for (const run of joinRuns(pieces)) {
    if (!run.text.trim()) continue
    for (const [start, end] of matchRanges(run.text, terms)) {
      const a = locate(run, start, false),
        b = locate(run, end, true)
      const range = document.createRange()
      range.setStart(a.node, a.offset)
      range.setEnd(b.node, b.offset)
      out.push(range)
    }
  }
  return out
}
