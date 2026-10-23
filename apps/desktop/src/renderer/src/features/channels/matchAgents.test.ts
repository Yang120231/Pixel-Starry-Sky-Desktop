// 新建频道的 AI 成员搜索：按名字、项目筛，不分大小写
import { describe, expect, it } from 'vitest'
import { matchAgents } from './model'

describe('matchAgents', () => {
  const agents = [
    { name: '前端', project: 'pixel-web' },
    { name: 'Review', project: null },
    { name: '文档', project: 'Docs' },
  ]
  it('空查询全部；按名字或项目匹配，不分大小写', () => {
    expect(matchAgents(agents, '  ')).toEqual(agents)
    expect(matchAgents(agents, 'review').map(a => a.name)).toEqual(['Review'])
    expect(matchAgents(agents, 'docs').map(a => a.name)).toEqual(['文档'])
    expect(matchAgents(agents, 'WEB').map(a => a.name)).toEqual(['前端'])
    expect(matchAgents(agents, '没有')).toEqual([])
  })
})
