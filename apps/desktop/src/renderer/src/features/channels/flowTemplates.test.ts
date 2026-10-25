import { describe, expect, it } from 'vitest'
import type { ChannelFlow } from '../../../../shared/types/channels'
import type { ChannelMember } from '@/data/types'
import { applyTemplate, parseTemplates, toTemplate, type FlowTemplate } from './flowTemplates'

const agent = (id: string, name: string, engine: 'claude' | 'codex'): ChannelMember =>
  ({ id, kind: 'agent', name, engine }) as ChannelMember

const flow: ChannelFlow = {
  title: 'x',
  status: 'done',
  maxRejects: 3,
  isolate: true,
  limits: { rounds: 12, minutes: 60 },
  steps: [
    {
      id: 's1',
      title: '做 {request}',
      memberId: 'a1',
      deps: [],
      kind: 'work',
      settings: { model: 'opus', effort: 'high' },
      taskId: 't1',
      status: 'delivered',
      rejects: 1,
      result: { summary: 'ok', files: [] },
    },
    {
      id: 's2',
      title: '审',
      memberId: 'a2',
      deps: ['s1'],
      kind: 'review',
      target: 's1',
      gate: true,
      taskId: null,
      status: 'pending',
      rejects: 0,
    },
  ],
}
const lookup = (id: string) =>
  ({ a1: { name: '前端', engine: 'claude' as const }, a2: { name: '审查员', engine: 'codex' as const } })[
    id as 'a1' | 'a2'
  ]

describe('flowTemplates', () => {
  const t = { ...toTemplate(flow, ' 常用 ', lookup), id: 'tp' } as FlowTemplate

  it('toTemplate 去掉运行时字段、用名字', () => {
    expect(t.name).toBe('常用')
    expect(t.steps[0]).toEqual({
      id: 's1',
      title: '做 {request}',
      member: '前端',
      engine: 'claude',
      deps: [],
      kind: 'work',
      settings: { model: 'opus', effort: 'high' },
    })
    expect(JSON.stringify(t)).not.toContain('taskId')
  })

  it('applyTemplate 对上成员、替换 {request}、保留同引擎的模型', () => {
    const r = applyTemplate(t, '登录页', [agent('x1', '前端', 'claude'), agent('x2', '审查员', 'codex')])
    expect(r.unmatched).toBe(0)
    expect(r.title).toBe('登录页')
    expect(r.steps[0]).toMatchObject({
      memberId: 'x1',
      title: '做 登录页',
      settings: { model: 'opus', effort: 'high' },
    })
    expect(r.steps[1]).toMatchObject({ memberId: 'x2', gate: true, target: 's1' })
    expect(r.limits).toEqual({ rounds: 12, minutes: 60, costUsd: null })
    const priced = { ...t, limits: { rounds: 1, minutes: 2, costUsd: 5 } }
    expect(applyTemplate(priced, 'q', []).limits?.costUsd).toBe(5)
    const bad = { ...t, limits: { rounds: 1, minutes: 2, costUsd: -3 } }
    expect(applyTemplate(bad, 'q', []).limits?.costUsd).toBeNull()
  })

  it('名字不分大小写；对不上留空；引擎不同丢掉模型', () => {
    const r = applyTemplate(t, 'q', [agent('x1', '前端', 'codex')])
    expect(r.unmatched).toBe(1)
    expect(r.steps[0].settings).toEqual({ effort: 'high' })
    expect(r.steps[1].memberId).toBe('')
    const dev = applyTemplate({ ...t, steps: [{ ...t.steps[0], member: 'Dev' }] }, 'q', [agent('d', 'dev', 'claude')])
    expect(dev.unmatched).toBe(0)
  })

  it('坏数据回退', () => {
    expect(parseTemplates('{bad')).toEqual([])
    expect(parseTemplates('{"a":1}')).toEqual([])
    expect(parseTemplates(JSON.stringify([t, { id: 1 }, { ...t, steps: [] }]))).toEqual([t])
  })
})
