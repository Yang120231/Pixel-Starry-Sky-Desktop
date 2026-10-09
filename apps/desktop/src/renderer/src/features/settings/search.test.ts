import { describe, expect, it } from 'vitest'
import { matchModels } from '../account/platform'
import { envLines, parseEnvLines } from './engines/envLines'
import { SETTINGS_INDEX, searchSettings } from './searchIndex'

const label = (s: string) =>
  ({
    account: '账号',
    models: '模型与额度',
    engines: '本机引擎',
    usage: '用量',
    appearance: '外观',
    shortcuts: '快捷键',
    about: '关于',
  })[s] ?? s

describe('设置搜索（plan-search-panes-compact §1）', () => {
  it('标题命中排在关键词命中前面', () => {
    const hits = searchSettings('压缩', label)
    expect(hits[0]).toMatchObject({ section: 'engines', title: '压缩上下文用的模型' })
  })
  it('关键词、页面名、英文都能搜，忽略大小写和空格', () => {
    expect(searchSettings('HTTPS_PROXY', label).map(h => h.title)).toContain('环境变量')
    expect(searchSettings('隐藏 模型', label).map(h => h.title)).toContain('菜单里显示的模型')
    expect(searchSettings('本机引擎', label).length).toBeGreaterThan(0)
    expect(searchSettings('   ', label)).toEqual([])
    expect(searchSettings('完全不存在的设置', label)).toEqual([])
  })
  it('索引没有重复的（页面，标题）', () => {
    const keys = SETTINGS_INDEX.map(e => `${e.section}/${e.title}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('引擎详情页里的设置带上引擎，点结果时先打开详情（engine-settings-redesign §3.1）', () => {
    expect(searchSettings('输出风格', label)[0]).toMatchObject({
      section: 'engines',
      title: '输出风格',
      engine: 'claude',
    })
    expect(searchSettings('提问', label)[0]).toMatchObject({ title: '允许中途向我提问', engine: 'claude' })
    expect(searchSettings('升级', label).map(h => h.title)).toContain('检查更新')
    expect(searchSettings('autocompact', label)[0]).toMatchObject({ title: '自动压缩触发点' })
    // 只在列表页的不带
    expect(SETTINGS_INDEX.find(e => e.title === 'Codex')?.engine).toBeUndefined()
  })
})

describe('模型搜索', () => {
  it('忽略大小写、空格和连字符', () => {
    const all = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-4-5-20251101', 'gpt-5.5']
    expect(matchModels(all, 'opus')).toEqual(['claude-opus-5-5', 'claude-opus-4-5-20251101'])
    expect(matchModels(all, 'opus 5')).toEqual(['claude-opus-5-5'])
    expect(matchModels(all, 'OPUS55')).toEqual(['claude-opus-5-5'])
    expect(matchModels(all, '')).toEqual(all)
  })
})

describe('环境变量文本框', () => {
  it('KEY=VALUE 每行一条，空行和 # 注释忽略，值里可以有等号', () => {
    expect(parseEnvLines('HTTPS_PROXY=http://127.0.0.1:7890\n\n# 注释\nA=b=c')).toEqual({
      env: { HTTPS_PROXY: 'http://127.0.0.1:7890', A: 'b=c' },
      bad: null,
    })
    expect(envLines({ A: '1', B: '2' })).toBe('A=1\nB=2')
  })
  it('变量名不对时指出是哪一行', () => {
    expect(parseEnvLines('OK=1\nBAD-NAME=2').bad).toBe('BAD-NAME=2')
    expect(parseEnvLines('没有等号').bad).toBe('没有等号')
  })
})
