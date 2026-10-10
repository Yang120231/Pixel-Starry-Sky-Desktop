// 同一个块里相邻的文字节点连成一段（docs/ui/workbench-ux-3.md §2.7）：代码着色把 `step3_7(` 拆成 `step3_7` 和 `(`
// 两个节点，一个节点一个节点地找会漏掉。这里只做连段和位置换算，不碰 DOM，方便测试。

export interface TextPiece<N> {
  node: N
  /** 往上第一个不是行内元素的祖先；相邻且块相同的才连在一起 */
  block: unknown
  text: string
}

export interface TextRun<N> {
  text: string
  nodes: N[]
  /** 每个节点在 text 里的起点 */
  starts: number[]
}

export function joinRuns<N>(pieces: Iterable<TextPiece<N>>): TextRun<N>[] {
  const runs: TextRun<N>[] = []
  let current: (TextRun<N> & { block: unknown }) | null = null
  for (const piece of pieces) {
    if (!current || current.block !== piece.block) {
      current = { text: '', nodes: [], starts: [], block: piece.block }
      runs.push(current)
    }
    current.starts.push(current.text.length)
    current.nodes.push(piece.node)
    current.text += piece.text
  }
  return runs.map(({ text, nodes, starts }) => ({ text, nodes, starts }))
}

/** 段里的位置落在哪个节点的第几个字。end：命中的终点正好在两个节点交界时算前一个节点的末尾 */
export function locate<N>(run: TextRun<N>, offset: number, end: boolean): { node: N; offset: number } {
  let lo = 0,
    hi = run.starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (end ? run.starts[mid] < offset : run.starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return { node: run.nodes[lo], offset: offset - run.starts[lo] }
}
