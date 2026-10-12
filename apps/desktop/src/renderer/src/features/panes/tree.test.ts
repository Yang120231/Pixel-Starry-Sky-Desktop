import { describe, expect, it } from 'vitest'
import {
  activateTab,
  closeTab,
  collapseLeaf,
  computeRects,
  cycleFocus,
  dragDivider,
  equalize,
  findSplit,
  focusIndex,
  initialLayout,
  leaves,
  moveTab,
  moveTabToEdge,
  openTab,
  parseLayout,
  pruneTabs,
  removeLeaf,
  replaceTab,
  splitLeaf,
  splitStart,
  toggleMaximize,
  visibleTabs,
  type Layout,
} from './tree'

const base = (): Layout => initialLayout('L1', 's1')

describe('标签', () => {
  it('打开新标签加在当前标签后面并激活', () => {
    let l = openTab(base(), 's2')
    l = activateTab(l, 'L1', 's1')
    l = openTab(l, 's3')
    expect(leaves(l.root)[0].tabs).toEqual(['s1', 's3', 's2'])
    expect(leaves(l.root)[0].active).toBe('s3')
  })

  it('已打开的标签不重复，切到它所在的窗格', () => {
    let l = splitLeaf(base(), 'L1', 'row', 'L2', 'S1')
    l = openTab(l, 's2')
    expect(l.focused).toBe('L2')
    l = openTab(l, 's1')
    expect(l.focused).toBe('L1')
    expect(leaves(l.root).flatMap(x => x.tabs)).toEqual(['s1', 's2'])
  })

  it('关闭当前标签后显示右边的，没有就左边的', () => {
    let l = openTab(openTab(base(), 's2'), 's3')
    l = activateTab(l, 'L1', 's2')
    l = closeTab(l, 'L1', 's2')
    expect(leaves(l.root)[0].active).toBe('s3')
    l = closeTab(l, 'L1', 's3')
    expect(leaves(l.root)[0].active).toBe('s1')
    l = closeTab(l, 'L1', 's1')
    expect(leaves(l.root)[0]).toMatchObject({ tabs: [], active: null })
  })

  it('新会话标签换成真正的会话 id', () => {
    let l = openTab(base(), 'new:1')
    l = replaceTab(l, 'new:1', 's9')
    expect(leaves(l.root)[0].tabs).toEqual(['s1', 's9'])
    expect(leaves(l.root)[0].active).toBe('s9')
  })

  it('pruneTabs 去掉已删除的会话', () => {
    const l = pruneTabs(openTab(base(), 's2'), t => t !== 's1')
    expect(leaves(l.root)[0].tabs).toEqual(['s2'])
  })
})

describe('拖动移动标签', () => {
  it('同窗格插入缝先扣除源标签，向前向后与末尾排序不丢标签', () => {
    const original = openTab(openTab(base(), 's2'), 's3')
    const back = moveTab(original, 's1', 'L1', 3)
    expect(leaves(back.root)[0].tabs).toEqual(['s2', 's3', 's1'])
    expect(leaves(moveTab(back, 's1', 'L1', 0).root)[0].tabs).toEqual(['s1', 's2', 's3'])
    expect(leaves(moveTab(original, 's2', 'L1', 2).root)[0].tabs).toEqual(['s1', 's2', 's3'])
    expect(leaves(original.root)[0].tabs).toEqual(['s1', 's2', 's3'])
  })

  it('跨窗格移动当前标签后源激活邻居，目标激活移动标签', () => {
    const l = openTab(splitLeaf(openTab(base(), 's2'), 'L1', 'row', 'L2', 'S1'), 's3')
    const next = moveTab(l, 's2', 'L2', 0)
    expect(leaves(next.root)).toMatchObject([
      { id: 'L1', tabs: ['s1'], active: 's1' },
      { id: 'L2', tabs: ['s2', 's3'], active: 's2' },
    ])
    expect(next.focused).toBe('L2')
  })

  it('移走源窗格唯一标签后合并布局，不重复或关闭会话', () => {
    const l = openTab(splitLeaf(base(), 'L1', 'row', 'L2', 'S1'), 's2')
    const next = moveTab(l, 's1', 'L2', 1)
    expect(next.root).toMatchObject({ type: 'leaf', id: 'L2', tabs: ['s2', 's1'], active: 's1' })
    expect(next.focused).toBe('L2')
  })

  it.each(['left', 'right', 'top', 'bottom'] as const)('拖到自己的 %s 边，拆分保留其余标签', edge => {
    const next = moveTabToEdge(openTab(base(), 's2'), 's2', 'L1', edge, 'L2', 'S1')
    const before = edge === 'left' || edge === 'top'
    expect(leaves(next.root).map(l => l.id)).toEqual(before ? ['L2', 'L1'] : ['L1', 'L2'])
    expect(
      leaves(next.root)
        .flatMap(l => l.tabs)
        .sort(),
    ).toEqual(['s1', 's2'])
    expect(next.focused).toBe('L2')
    expect(next.maximized).toBeNull()
    const start = splitStart(next, 'L2', 'L1')
    expect(computeRects(start.root).panes.get('L2')).toMatchObject(
      edge === 'left' || edge === 'right' ? { w: 0 } : { h: 0 },
    )
    expect(computeRects(start.root).panes.get('L1')).toMatchObject({ w: 1, h: 1 })
  })

  it('移到别的窗格边缘时清除移空的源，保留所有会话与相对顺序', () => {
    const l = openTab(splitLeaf(base(), 'L1', 'row', 'L2', 'S1'), 's2')
    const next = moveTabToEdge(l, 's1', 'L2', 'right', 'L3', 'S2')
    expect(leaves(next.root)).toMatchObject([
      { id: 'L2', tabs: ['s2'] },
      { id: 'L3', tabs: ['s1'] },
    ])
    expect(computeRects(next.root).panes.get('L3')!.w).toBe(0.5)
  })

  it('嵌套源窗格清空后整理布局，激活目标并还原放大', () => {
    let l = openTab(splitLeaf(base(), 'L1', 'row', 'L2', 'S1'), 's2')
    l = openTab(splitLeaf(l, 'L2', 'col', 'L3', 'S2'), 'new:3')
    l = toggleMaximize(l, 'L3')
    const next = moveTab(l, 'new:3', 'L1', 0)
    expect(leaves(next.root).map(l => l.id)).toEqual(['L1', 'L2'])
    expect(leaves(next.root)[0].tabs).toEqual(['new:3', 's1'])
    expect(next.maximized).toBeNull()
    expect(parseLayout(next)).toEqual(next)
  })

  it('失效目标、缺失标签、非法索引和自己的唯一标签分屏保持原布局', () => {
    const l = base()
    expect(moveTab(l, 'missing', 'L1', 0)).toBe(l)
    expect(moveTab(l, 's1', 'missing', 0)).toBe(l)
    expect(moveTab(l, 's1', 'L1', NaN)).toBe(l)
    expect(moveTabToEdge(l, 's1', 'L1', 'right', 'L2', 'S1')).toBe(l)
  })
})

describe('拆分与关闭', () => {
  it('同方向拆分插在后面并平分原占比', () => {
    let l = splitLeaf(base(), 'L1', 'row', 'L2', 'S1')
    l = splitLeaf(l, 'L2', 'row', 'L3', 'S2')
    const s = findSplit(l.root, 'S1')!
    expect(s.children.map(c => c.id)).toEqual(['L1', 'L2', 'L3'])
    expect(s.sizes).toEqual([1, 0.5, 0.5])
    expect(l.focused).toBe('L3')
  })

  it('不同方向拆分包成新的 split', () => {
    let l = splitLeaf(base(), 'L1', 'row', 'L2', 'S1')
    l = splitLeaf(l, 'L2', 'col', 'L3', 'S2')
    expect(findSplit(l.root, 'S2')).toMatchObject({ dir: 'col', sizes: [1, 1] })
    expect(leaves(l.root).map(x => x.id)).toEqual(['L1', 'L2', 'L3'])
  })

  it('拆分动画起点：新窗格占比 0，前一个窗格占回原大小', () => {
    const target = splitLeaf(splitLeaf(base(), 'L1', 'row', 'L2', 'S1'), 'L2', 'row', 'L3', 'S2')
    expect(findSplit(splitStart(target, 'L3').root, 'S1')!.sizes).toEqual([1, 1, 0])
  })

  it('关闭窗格后父节点只剩一个子节点时折叠、同方向拍平', () => {
    let l = splitLeaf(base(), 'L1', 'row', 'L2', 'S1')
    l = splitLeaf(l, 'L2', 'col', 'L3', 'S2')
    l = removeLeaf(l, 'L3', 'X')
    expect(l.root).toMatchObject({ id: 'S1', dir: 'row' })
    expect(leaves(l.root).map(x => x.id)).toEqual(['L1', 'L2'])
    expect(l.focused).toBe('L2')
  })

  it('收拢到 0 再删除，剩下的占比不变', () => {
    let l = splitLeaf(splitLeaf(base(), 'L1', 'row', 'L2', 'S1'), 'L2', 'row', 'L3', 'S2')
    l = collapseLeaf(l, 'L2')
    expect(findSplit(l.root, 'S1')!.sizes).toEqual([1, 0, 0.5])
    l = removeLeaf(l, 'L2', 'X')
    expect(findSplit(l.root, 'S1')!.sizes).toEqual([1, 0.5])
  })

  it('删除最后一个窗格时留一个空窗格', () => {
    const l = removeLeaf(base(), 'L1', 'X')
    expect(l.root).toMatchObject({ type: 'leaf', id: 'X', tabs: [] })
    expect(l.focused).toBe('X')
  })

  it('均分', () => {
    let l = splitLeaf(splitLeaf(base(), 'L1', 'row', 'L2', 'S1'), 'L2', 'row', 'L3', 'S2')
    l = equalize(l, 'S1')
    expect(findSplit(l.root, 'S1')!.sizes).toEqual([1, 1, 1])
  })
})

describe('焦点与放大', () => {
  it('按序号、循环切换窗格', () => {
    let l = splitLeaf(splitLeaf(base(), 'L1', 'row', 'L2', 'S1'), 'L2', 'row', 'L3', 'S2')
    l = focusIndex(l, 0)
    expect(l.focused).toBe('L1')
    expect(cycleFocus(l, -1).focused).toBe('L3')
    expect(focusIndex(l, 9).focused).toBe('L1')
  })

  it('放大 / 还原；只有一个窗格时不放大；切到别的窗格自动还原', () => {
    expect(toggleMaximize(base(), 'L1').maximized).toBeNull()
    let l = splitLeaf(base(), 'L1', 'row', 'L2', 'S1')
    l = toggleMaximize(l, 'L1')
    expect(l.maximized).toBe('L1')
    expect(cycleFocus(l, 1).maximized).toBeNull()
    expect(toggleMaximize(l, 'L1').maximized).toBeNull()
  })

  it('拖分隔线：两边不小于最小尺寸；拖过最小尺寸到头时给出要放大的窗格', () => {
    // 上下两块占比各 1，共 1000px（一份占比 = 500px），最小 0.6（300px）
    const l = splitLeaf(base(), 'L1', 'col', 'L2', 'S1')
    const split = findSplit(l.root, 'S1')!
    const drag = (a: number) => dragDivider(split, 0, a, 0.6, 500)
    expect(drag(0.8)).toEqual({ sizes: [0.8, 1.2], maximize: null })
    // 往上拖过最小尺寸，但没超过 80px：只停在最小尺寸
    expect(drag(0.5)).toEqual({ sizes: [0.6, 1.4], maximize: null })
    // 往上拖到头：放大下面的；往下拖到头：放大上面的
    expect(drag(0.4)).toEqual({ sizes: [0.6, 1.4], maximize: 'L2' })
    expect(drag(1.7).maximize).toBe('L1')
  })

  it('拖到头时被挤的一边是多个窗格的，不放大', () => {
    let l = splitLeaf(base(), 'L1', 'col', 'L2', 'S1')
    l = splitLeaf(l, 'L2', 'row', 'L3', 'S2')
    const split = findSplit(l.root, 'S1')!
    expect(split.children[1].type).toBe('split')
    expect(dragDivider(split, 0, 0, 0.6, 500).maximize).toBeNull()
    expect(dragDivider(split, 0, 2, 0.6, 500).maximize).toBe('L1')
  })

  it('visibleTabs 是每个窗格的当前标签', () => {
    let l = splitLeaf(openTab(base(), 's2'), 'L1', 'row', 'L2', 'S1')
    l = openTab(l, 's3')
    expect(visibleTabs(l)).toEqual(['s2', 's3'])
  })
})

describe('几何', () => {
  it('按占比算出窗格矩形和分隔线', () => {
    let l = splitLeaf(base(), 'L1', 'row', 'L2', 'S1')
    l = splitLeaf(l, 'L2', 'col', 'L3', 'S2')
    const { panes, dividers } = computeRects(l.root)
    expect(panes.get('L1')).toEqual({ x: 0, y: 0, w: 0.5, h: 1 })
    expect(panes.get('L3')).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
    expect(dividers).toHaveLength(2)
    expect(dividers.find(d => d.splitId === 'S1')!.at).toBe(0.5)
  })
})

describe('读取保存的布局', () => {
  it('合法数据原样恢复（放大状态不恢复）', () => {
    const l = { ...splitLeaf(openTab(base(), 's2'), 'L1', 'col', 'L2', 'S1'), maximized: 'L1' }
    const parsed = parseLayout(JSON.parse(JSON.stringify(l)))!
    expect(parsed.root).toEqual(l.root)
    expect(parsed.focused).toBe('L2')
    expect(parsed.maximized).toBeNull()
  })

  it('结构不对返回 null；重复 id、坏占比被拒绝或修正', () => {
    expect(parseLayout(null)).toBeNull()
    expect(parseLayout({ root: { type: 'split', id: 'S', dir: 'row', children: [], sizes: [] } })).toBeNull()
    const dup = {
      root: {
        type: 'split',
        id: 'S',
        dir: 'row',
        sizes: [1, 1],
        children: [
          { type: 'leaf', id: 'A', tabs: [] },
          { type: 'leaf', id: 'A', tabs: [] },
        ],
      },
    }
    expect(parseLayout(dup)).toBeNull()
    const bad = {
      root: {
        type: 'split',
        id: 'S',
        dir: 'row',
        sizes: [-1, 'x'],
        children: [
          { type: 'leaf', id: 'A', tabs: ['a', 'a'] },
          { type: 'leaf', id: 'B', tabs: [] },
        ],
      },
      focused: 'nope',
    }
    const p = parseLayout(bad)!
    expect(findSplit(p.root, 'S')!.sizes).toEqual([1, 1])
    expect(leaves(p.root)[0]).toMatchObject({ tabs: ['a'], active: 'a' })
    expect(p.focused).toBe('A')
  })
})
