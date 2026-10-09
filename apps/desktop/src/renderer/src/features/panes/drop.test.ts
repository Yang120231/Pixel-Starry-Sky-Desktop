import { describe, expect, it } from 'vitest'
import { dropLayout, dropProblem, edgeAt } from './drop'
import { computeRects, initialLayout, openTab, splitLeaf } from './tree'

describe('拖动命中与最终尺寸', () => {
  const box = { x: 100, y: 100, width: 800, height: 600 }
  it('区分四条边、中央和窗格外，角落取最近的边', () => {
    expect(edgeAt(box, 110, 400)).toBe('left')
    expect(edgeAt(box, 890, 400)).toBe('right')
    expect(edgeAt(box, 400, 110)).toBe('top')
    expect(edgeAt(box, 400, 690)).toBe('bottom')
    expect(edgeAt(box, 500, 400)).toBeNull()
    expect(edgeAt(box, 90, 400)).toBeNull()
    expect(edgeAt(box, 110, 115)).toBe('left')
  })
  it('窄窗格也保留中央合并区域', () => {
    expect(edgeAt({ x: 0, y: 0, width: 200, height: 150 }, 100, 75)).toBeNull()
    expect(edgeAt({ x: 0, y: 0, width: 0, height: 150 }, 0, 10)).toBeNull()
  })
  it('边缘拆分同时检查新窗格和保留窗格的宽高下限', () => {
    const l = openTab(initialLayout('L1', 's1'), 's2')
    expect(dropProblem(l, 's2', { leafId: 'L1', edge: 'right' }, { width: 800, height: 600 })).toBeNull()
    expect(dropProblem(l, 's2', { leafId: 'L1', edge: 'right' }, { width: 799, height: 600 })).toContain('空间不足')
    expect(dropProblem(l, 's2', { leafId: 'L1', edge: 'bottom' }, { width: 800, height: 599 })).toContain('空间不足')
    expect(dropProblem(l, 's2', { leafId: 'L1', edge: 'right' }, { width: 800, height: 299 })).toContain('空间不足')
  })
  it('移空源后两格重排不会按三格误判，非空源则保留尺寸限制', () => {
    const l = openTab(splitLeaf(initialLayout('L1', 's1'), 'L1', 'row', 'L2', 'S1'), 's2')
    const area = { width: 900, height: 600 }
    expect(dropProblem(l, 's1', { leafId: 'L2', edge: 'left' }, area)).toBeNull()
    expect(dropProblem(openTab(l, 's3'), 's2', { leafId: 'L1', edge: 'left' }, area)).toContain('空间不足')
  })
  it('合并到空窗格不受拆分尺寸限制，不能把唯一标签拆出空白副本', () => {
    const l = splitLeaf(initialLayout('L1', 's1'), 'L1', 'row', 'L2', 'S1')
    expect(dropProblem(l, 's1', { leafId: 'L2', index: 0 }, { width: 500, height: 300 })).toBeNull()
    expect(dropProblem(l, 's1', { leafId: 'L1', edge: 'left' }, { width: 1600, height: 900 })).toContain('另一个对话')
    expect(dropProblem(l, 's1', { leafId: 'missing', index: 0 }, { width: 1600, height: 900 })).toContain('已关闭')
  })
  it('容纳三列时自动均分相邻列，而空间不足仍拒绝拆分', () => {
    const l = openTab(openTab(splitLeaf(initialLayout('L1', 's1'), 'L1', 'row', 'L2', 'S1'), 's2'), 's3')
    const target = { leafId: 'L2', edge: 'right' } as const
    const area = { width: 1200, height: 600 }
    expect(dropProblem(l, 's3', target, area)).toBeNull()
    const next = dropLayout(l, 's3', target, 'L3', 'S2', area)
    expect([...computeRects(next.root).panes.values()].map(r => r.w)).toEqual([1 / 3, 1 / 3, 1 / 3])
    expect(dropProblem(l, 's3', target, { width: 1199, height: 600 })).toContain('空间不足')
  })
})
