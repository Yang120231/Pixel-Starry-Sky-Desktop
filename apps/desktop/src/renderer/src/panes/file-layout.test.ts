import { describe, expect, it } from 'vitest'
import { activateTab, fileTab, initialLayout, isFileTab, leaves, parseFileTab, pruneTabs } from './tree'
import { openFileLayout } from './file-layout'

describe('窗格文件标签', () => {
  const tab = fileTab({ projectId: '项目:1' }, 'src/中文 # (1)%?.ts')
  it('标签编码保留特殊路径与项目 / 会话引用，损坏数据返回 null', () => {
    expect(parseFileTab(tab)).toEqual({ ref: { projectId: '项目:1' }, path: 'src/中文 # (1)%?.ts' })
    expect(parseFileTab(fileTab({ sessionId: 's' }, 'a\\b.txt'))).toEqual({ ref: { sessionId: 's' }, path: 'a/b.txt' })
    for (const value of ['file:bad', 'session', 'file:%5B%5D']) expect(isFileTab(value)).toBe(false)
  })
  it('首次宽窗口在右边拆分，再次打开聚焦已有文件，后续文件复用编辑器窗格', () => {
    const layout = openFileLayout(initialLayout('left', 'session'), tab, { width: 1000, height: 600 }, 'right', 'split')
    expect(leaves(layout.root).map(l => l.tabs)).toEqual([['session'], [tab]])
    const second = fileTab({ projectId: 'p' }, 'other.md')
    const reused = openFileLayout(activateTab(layout, 'left', 'session'), second, { width: 1000, height: 600 }, 'new', 'split2')
    expect(leaves(reused.root)).toHaveLength(2)
    expect(leaves(reused.root)[1].tabs).toEqual([tab, second])
    const focused = openFileLayout(reused, tab, { width: 1000, height: 600 }, 'new', 'split2')
    expect(leaves(focused.root)[1].active).toBe(tab)
  })
  it('窄窗口同窗格增加标签；会话清理可独立保留文件标签', () => {
    const layout = openFileLayout(initialLayout('one', 'expired'), tab, { width: 700, height: 600 }, 'two', 'split')
    expect(leaves(layout.root)).toHaveLength(1)
    expect(leaves(pruneTabs(layout, isFileTab).root)[0].tabs).toEqual([tab])
  })
})
