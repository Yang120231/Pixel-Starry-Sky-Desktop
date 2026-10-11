import { describe, expect, it } from 'vitest'
import { layoutGraph, spacerRow, type GraphCommit } from './graph'

const c = (hash: string, ...parents: string[]): GraphCommit => ({ hash, parents })
const lanes = (commits: GraphCommit[]) => layoutGraph(commits).map(r => r.lane)

describe('提交历史的分支线', () => {
  it('直线：一条车道，上下相连，最后一个提交没有向下的线', () => {
    const rows = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')])
    expect(rows.map(r => r.lane)).toEqual([0, 0, 0])
    expect(rows[0].lines).toEqual([{ kind: 'bottom', from: 0, to: 0, color: 0 }])
    expect(rows[1].lines.map(l => l.kind)).toEqual(['top', 'bottom'])
    expect(rows[2].lines.map(l => l.kind)).toEqual(['top'])
    expect(rows.every(r => r.width === 1 && !r.merge)).toBe(true)
  })

  it('分叉再合并：合并提交另开车道，合并完车道空出来', () => {
    // m 合并了 f（另一条线），两条线都从 a 分出来
    const rows = layoutGraph([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')])
    expect(rows.map(r => r.lane)).toEqual([0, 1, 0, 0])
    expect(rows[0]).toMatchObject({ merge: true, width: 2 })
    expect(rows[0].lines).toContainEqual({ kind: 'bottom', from: 0, to: 1, color: 1 })
    // f 这一行：车道 0 穿过
    expect(rows[1].lines).toContainEqual({ kind: 'full', from: 0, to: 0, color: 0 })
    // a：车道 1 的线汇进来
    expect(rows[3].lines).toContainEqual({ kind: 'top', from: 1, to: 0, color: 1 })
    expect(rows[3].width).toBe(2)
  })

  it('章鱼合并：每个额外的父提交一条车道', () => {
    const rows = layoutGraph([c('o', 'a', 'x', 'y'), c('y', 'a'), c('x', 'a'), c('a')])
    expect(rows.map(r => r.lane)).toEqual([0, 2, 1, 0])
    expect(rows[0].lines.filter(l => l.kind === 'bottom').map(l => l.to)).toEqual([0, 1, 2])
    expect(
      rows[3].lines
        .filter(l => l.kind === 'top')
        .map(l => l.from)
        .sort(),
    ).toEqual([0, 1, 2])
  })

  it('车道复用：空出来的车道给后面的分支用', () => {
    // 两个各自独立的分支头，前一个合并结束后它的车道给下一个
    const rows = layoutGraph([c('m', 'b', 'f'), c('f', 'b'), c('b', 'a'), c('t', 'a'), c('a')])
    expect(rows.map(r => r.lane)).toEqual([0, 1, 0, 1, 0])
  })

  it('分页接着算：多加载的一页不改变前面的行', () => {
    const all = [c('e', 'd'), c('d', 'c', 'x'), c('x', 'c'), c('c', 'b'), c('b', 'a'), c('a')]
    const first = layoutGraph(all.slice(0, 3))
    expect(layoutGraph(all).slice(0, 3)).toEqual(first)
    expect(lanes(all)).toEqual([0, 0, 1, 0, 0, 0])
  })

  it('颜色轮换 5 种', () => {
    const heads = Array.from({ length: 7 }, (_, i) => c('h' + i, 'root'))
    const rows = layoutGraph([...heads, c('root')])
    expect(rows.slice(0, 7).map(r => r.color)).toEqual([0, 1, 2, 3, 4, 0, 1])
  })

  it('特殊行：穿过的线变成竖线，节点在下一行的车道上并连下去', () => {
    const rows = layoutGraph([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')])
    // 插在 a 前面：车道 1 汇进 a 的线在特殊行里是竖线
    const spacer = spacerRow(rows[3])
    expect(spacer.lane).toBe(0)
    expect(spacer.lines).toContainEqual({ kind: 'full', from: 1, to: 1, color: 1 })
    expect(spacer.lines).toContainEqual({ kind: 'top', from: 0, to: 0, color: 0 })
    expect(spacer.lines).toContainEqual({ kind: 'bottom', from: 0, to: 0, color: 0 })
    // 插在最上面的分支头前：只有向下的线
    expect(spacerRow(rows[0]).lines).toEqual([{ kind: 'bottom', from: 0, to: 0, color: 0 }])
  })
})
