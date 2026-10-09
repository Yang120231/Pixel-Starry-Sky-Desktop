import { afterEach, describe, expect, it } from 'vitest'
import { allMessages, setCurrentLocale, tr, translateText, translateMessage } from './core'
import { searchSettings } from '../settings/searchIndex'

afterEach(() => setCurrentLocale('zh-CN'))
describe('中英文词典', () => {
  it('两种语言完整且插值参数一致', () => {
    for (const [key, value] of Object.entries(allMessages)) {
      expect(value.zh.trim(), key).not.toBe('')
      expect(value.en.trim(), key).not.toBe('')
      const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
      expect(params(value.en), key).toEqual(params(value.zh))
    }
  })
  it('宿主动态错误可以切回中文，原始引擎输出保持原文', () => {
    expect(translateMessage('工作目录不存在：D:\\中文文件', 'en-US')).toBe('Working directory not found: D:\\中文文件')
    expect(translateMessage('Working directory not found: D:\\中文文件', 'zh-CN')).toBe('工作目录不存在：D:\\中文文件')
    expect(translateMessage('Unexpected tool failure: EXTERNAL_123', 'en-US')).toBe(
      'Unexpected tool failure: EXTERNAL_123',
    )
  })
  it('几乎只有占位符的模板不会改坏引擎原文', () => {
    for (const text of [
      'Reconnecting... 3/5',
      'stream disconnected',
      'Too many requests',
      'Bad Gateway: upstream',
      'local · main',
    ]) {
      expect(translateMessage(text, 'zh-CN')).toBe(text)
    }
    expect(translateMessage('3月5日', 'en-US')).toBe('3月5日')
    // 有足够固定文字的宿主模板照常双向翻译
    expect(translateMessage('退出码 3', 'en-US')).not.toBe('退出码 3')
  })
  it('动态参数保留用户原始文字，包括插值符号', () => {
    setCurrentLocale('en-US')
    expect(tr('files.FileConfirm.message515', { p0: '中文文件{p0}.ts' })).toBe('中文文件{p0}.ts has unsaved changes')
    expect(translateText('用户项目名称')).toBe('用户项目名称')
    expect(translateText('src/中文文件.ts')).toBe('src/中文文件.ts')
  })
  it('英文设置搜索可以命中并保留稳定的原始定位标题', () => {
    setCurrentLocale('en-US')
    expect(searchSettings('language', s => s).some(e => e.title === '界面语言')).toBe(true)
    expect(searchSettings('compaction', s => s).some(e => e.title === '压缩上下文用的模型')).toBe(true)
    expect(searchSettings('主题', s => s).some(e => e.title === '主题')).toBe(true)
    expect(searchSettings('do not disturb', s => s).some(e => e.title === '勿扰')).toBe(true)
    expect(searchSettings('Reply failed', s => s).some(e => e.title === '回复出错')).toBe(true)
  })
})
