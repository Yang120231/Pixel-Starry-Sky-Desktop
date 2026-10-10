// 搜索结果的字段名按界面语言显示（docs/ui/workbench-ux-3.md §2.5）
import { afterEach, describe, expect, it } from 'vitest'
import { setCurrentLocale } from '@/i18n/core'
import { fieldLabel, projectLabel } from './fieldLabel'

describe('搜索字段名', () => {
  afterEach(() => setCurrentLocale('zh-CN'))

  it('中文界面照原文', () => {
    expect(fieldLabel('用户消息')).toBe('用户消息')
    expect(projectLabel('已移除的项目')).toBe('已移除的项目')
  })

  it('英文界面换成英文；不认识的和真实项目名照原样', () => {
    setCurrentLocale('en-US')
    expect(['会话标题', '用户消息', '助手回复', '系统提示', '命令输出', '文件改动'].map(fieldLabel)).toEqual([
      'Title',
      'Your message',
      'Reply',
      'Notice',
      'Command output',
      'File changes',
    ])
    expect(fieldLabel('新字段')).toBe('新字段')
    expect(projectLabel('已移除的项目')).toBe('Removed project')
    expect(projectLabel('项目')).toBe('项目')
  })
})
