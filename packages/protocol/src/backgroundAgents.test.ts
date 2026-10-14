import { describe, expect, it } from 'vitest'
import { backgroundAgents } from './backgroundAgents'

const sub = (id: string, label: string, status = 'running', background = true) => ({
  id,
  label,
  status,
  message: null,
  ...(background ? { background } : {}),
})
const task = (id: string, kind: string, description = '') => ({ id, kind, description, message: null })

describe('backgroundAgents', () => {
  it('合并后台子智能体和 local_agent / local_workflow 任务', () => {
    const r = backgroundAgents([sub('a', '甲')], [task('w', 'local_workflow', '编排'), task('b', 'local_bash', 'ping')])
    expect(r).toEqual([
      { id: 'a', label: '甲', kind: 'agent' },
      { id: 'w', label: '编排', kind: 'workflow' },
    ])
  })
  it('按 id 去重，名字优先用子智能体条的', () => {
    const r = backgroundAgents([sub('a', '甲')], [task('a', 'local_agent', '别名')])
    expect(r).toEqual([{ id: 'a', label: '甲', kind: 'agent' }])
  })
  it('跳过前台、已结束、shell、监视、远程', () => {
    const r = backgroundAgents(
      [sub('f', '前台', 'running', false), sub('d', '完', 'completed')],
      [task('m', 'monitor'), task('r', 'remote_agent'), task('s', 'local_bash')],
    )
    expect(r).toEqual([])
  })
  it('没有名字时用 id 前 8 位', () => {
    expect(backgroundAgents([], [task('abcdefghijkl', 'local_agent')])[0].label).toBe('abcdefgh')
  })
})
