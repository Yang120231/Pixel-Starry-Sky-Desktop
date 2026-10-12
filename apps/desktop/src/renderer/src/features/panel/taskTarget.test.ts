import { describe, expect, it } from 'vitest'
import { initialLayout, openTab, splitLeaf } from '@/features/panes/tree'
import { taskTarget } from './taskTarget'

// 标签 → 项目：a* 在项目 A，b* 在项目 B
const projectOf = (tab: string): string | null => (tab.startsWith('a') ? 'A' : tab.startsWith('b') ? 'B' : null)

describe('打开任务时焦点落到哪', () => {
  it('焦点标签已经在这个项目：不动', () => {
    expect(taskTarget(initialLayout('L1', 'a1'), projectOf, 'A', 'a9')).toEqual({ kind: 'stay' })
  })

  it('别的窗格正在显示这个项目的标签：切过去；只在后面的标签里也找得到', () => {
    const split = splitLeaf(initialLayout('L1', 'a1'), 'L1', 'row', 'L2', 'S1')
    const twoPanes = openTab(split, 'b1')
    expect(taskTarget(twoPanes, projectOf, 'A', 'a9')).toEqual({ kind: 'tab', leafId: 'L1', tab: 'a1' })
    // 同一个窗格里 a1 在后面、当前显示 b1
    const sameLeaf = openTab(initialLayout('L1', 'a1'), 'b1')
    expect(taskTarget(sameLeaf, projectOf, 'A', 'a9')).toEqual({ kind: 'tab', leafId: 'L1', tab: 'a1' })
  })

  it('没开着这个项目：打开它最近的会话；项目没有会话才新开', () => {
    const layout = initialLayout('L1', 'b1')
    expect(taskTarget(layout, projectOf, 'A', 'a9')).toEqual({ kind: 'session', id: 'a9' })
    expect(taskTarget(layout, projectOf, 'A', null)).toEqual({ kind: 'new' })
  })
})
