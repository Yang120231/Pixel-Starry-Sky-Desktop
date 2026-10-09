import { describe, expect, it } from 'vitest'
import { itemSearchMatch, searchSnippet, searchTerms, titleMatch } from '../src/search'

describe('字面搜索与原文高亮', () => {
  it('方括号、加号、括号和路径不作为正则，片段保留原文大小写', () => {
    const text = '处理 SRC/App.ts: Error [42] (cache+)'
    const terms = searchTerms('src/app.ts [42] (CACHE+)')
    const fragments = searchSnippet(text, terms)
    expect(fragments.map(f => f.text).join('')).toBe(text)
    expect(fragments.filter(f => f.match).map(f => f.text)).toEqual(['SRC/App.ts', '[42]', '(cache+)'])
  })
  it('重叠词只高亮一次，长输出在命中位置附近截取摘要', () => {
    const fragments = searchSnippet('无关'.repeat(500) + '错误提示' + '后文'.repeat(500), searchTerms('错误 错误提示'))
    expect(fragments.filter(f => f.match)).toEqual([{ text: '错误提示', match: true }])
    expect(fragments.map(f => f.text).join('').length).toBeLessThanOrEqual(182)
  })
  it('多词需要在同一字段命中；完全匹配比前缀和部分标题优先', () => {
    const terms = searchTerms('构建 错误')
    expect(
      itemSearchMatch(
        { kind: 'command', id: 'c', command: '构建', description: null, output: '错误', exitCode: 1, status: 'failed' },
        terms,
        'tools',
      ),
    ).toBeNull()
    expect(titleMatch('Build', searchTerms('build'), 'build')?.rank).toBe(0)
    expect(titleMatch('Build fix', searchTerms('build'), 'build')?.rank).toBe(1)
    expect(titleMatch('Fix Build', searchTerms('build'), 'build')?.rank).toBe(2)
  })
})
