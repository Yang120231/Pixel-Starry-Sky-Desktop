// 新任务的起点（docs/ui/workbench-ux-3.md §2.2）
import { afterEach, describe, expect, it } from 'vitest'
import { setCurrentLocale } from '@/i18n/core'
import { starters } from './starters'

describe('新任务的起点', () => {
  afterEach(() => setCurrentLocale('zh-CN'))

  it('有改动时第一个是看改动，写出文件数', () => {
    const list = starters(3)
    expect(list.map(s => s.id)).toEqual(['changes', 'explain', 'tests'])
    expect(list[0].label).toBe('看看未提交的改动（3 个文件）')
  })

  it('没有改动时不出现看改动', () => {
    expect(starters(0).map(s => s.id)).toEqual(['explain', 'tests'])
  })

  it('跟着界面语言：英文界面填英文', () => {
    setCurrentLocale('en-US')
    const [first] = starters(0)
    expect(first.label).toBe('Explain this project')
    expect(first.prompt).toMatch(/^Give me an overview of this project/)
  })
})
