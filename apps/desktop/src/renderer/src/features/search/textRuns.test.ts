// 文字节点连段与位置换算（docs/ui/workbench-ux-3.md §2.7）
import { describe, expect, it } from 'vitest'
import { matchRanges, searchTerms } from '@pixelsky/protocol'
import { joinRuns, locate } from './textRuns'

describe('文字节点连段', () => {
  it('同一个块里相邻的连起来，换了块就断开，回到原来的块也另起一段', () => {
    const runs = joinRuns([
      { node: 'a', block: 'pre', text: 'const x = step3_7' },
      { node: 'b', block: 'pre', text: '(' },
      { node: 'c', block: 'p', text: '段落' },
      { node: 'd', block: 'pre', text: '1)' },
    ])
    expect(runs.map(r => [r.text, r.nodes, r.starts])).toEqual([
      ['const x = step3_7(', ['a', 'b'], [0, 17]],
      ['段落', ['c'], [0]],
      ['1)', ['d'], [0]],
    ])
  })

  it('跨节点的命中换算回起止节点；终点在交界时算前一个节点的末尾', () => {
    const [run] = joinRuns([
      { node: 'a', block: 1, text: 'step3_7' },
      { node: 'b', block: 1, text: '(' },
      { node: 'c', block: 1, text: '0)' },
    ])
    const [[start, end]] = matchRanges(run.text, searchTerms('step3_7('))
    expect([locate(run, start, false), locate(run, end, true)]).toEqual([
      { node: 'a', offset: 0 },
      { node: 'b', offset: 1 },
    ])
    expect(locate(run, 7, true)).toEqual({ node: 'a', offset: 7 })
    expect(locate(run, 7, false)).toEqual({ node: 'b', offset: 0 })
  })
})
