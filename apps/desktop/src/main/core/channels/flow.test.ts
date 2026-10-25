import { describe, expect, it } from 'vitest'
import type { ChannelFlow } from '../../../shared/types/channels'
import { cleanSteps, draftProblem, planSteps, startable, withStep } from './flow'

const members: Record<string, { name: string; local: boolean }> = {
  a: { name: '画师', local: true },
  b: { name: '程序员', local: true },
  c: { name: '审查员', local: true },
  r: { name: '远端', local: false },
}
const member = (id: string) => members[id] ?? null

const draft = () =>
  cleanSteps([
    { id: 's1', title: '画贴图', memberId: 'a', kind: 'work' },
    { id: 's2', title: '写代码', memberId: 'b', deps: ['s1'], kind: 'work' },
    { id: 's3', title: '审查', memberId: 'c', kind: 'review', target: 's2', settings: { effort: 'low', fast: 'x' } },
    { id: 's4', title: '汇总', memberId: 'a', deps: ['s3', 'nope', 's4'], kind: 'summary' },
  ])

describe('流程草稿（docs/ui/channels-pipeline.md §4）', () => {
  it('清洗：运行时字段重置，审查步骤自动等被审的那一步，不存在的依赖和依赖自己去掉，设置只留认识的', () => {
    const steps = draft()
    expect(steps.every(s => s.status === 'pending' && s.taskId === null && s.rejects === 0)).toBe(true)
    expect(steps[2]).toMatchObject({ deps: ['s2'], target: 's2', settings: { effort: 'low' } })
    expect(steps[3].deps).toEqual(['s3'])
    expect(() => cleanSteps('x')).toThrow('步骤不正确')
    expect(() => cleanSteps([{ id: 'a' }, { id: 'a' }])).toThrow('重复')
  })

  it('校验：没写要做什么、没选成员、SSH 成员、审查没目标、绕成圈', () => {
    expect(draftProblem(draft(), member)).toBeNull()
    expect(draftProblem([], member)).toContain('还没有步骤')
    expect(draftProblem(cleanSteps([{ title: '', memberId: 'a' }]), member)).toContain('还没写')
    expect(draftProblem(cleanSteps([{ title: 'x', memberId: 'zz' }]), member)).toContain('还没选成员')
    expect(draftProblem(cleanSteps([{ title: 'x', memberId: 'r' }]), member)).toContain('SSH')
    expect(draftProblem(cleanSteps([{ title: 'x', memberId: 'c', kind: 'review' }]), member)).toContain('审哪一步')
    const loop = cleanSteps([
      { id: 'x', title: 'x', memberId: 'a', deps: ['y'] },
      { id: 'y', title: 'y', memberId: 'b', deps: ['x'] },
    ])
    expect(draftProblem(loop, member)).toContain('圈')
  })

  it('能开始的：还没开始、依赖都交付了', () => {
    let flow: ChannelFlow = { title: 't', status: 'running', steps: draft(), maxRejects: 3 }
    expect(startable(flow).map(s => s.id)).toEqual(['s1'])
    flow = withStep(flow, 's1', { status: 'delivered' })
    expect(startable(flow).map(s => s.id)).toEqual(['s2'])
    flow = withStep(flow, 's2', { status: 'running' })
    expect(startable(flow)).toEqual([])
  })

  it('成员拆好的流程：序号换成 id，成员按名字找，找不到报错', () => {
    const byName = (n: string) => Object.entries(members).find(([, m]) => m.name === n)?.[0] ?? null
    const steps = planSteps(
      [
        { title: '画贴图', member: '画师' },
        { title: '写代码', member: '程序员', deps: [1] },
        { title: '审查', member: '审查员', kind: 'review', target: 2 },
      ],
      byName,
    )
    expect(steps.map(s => [s.id, s.memberId, s.deps])).toEqual([
      ['s1', 'a', []],
      ['s2', 'b', ['s1']],
      ['s3', 'c', ['s2']],
    ])
    expect(() => planSteps([{ title: 'x', member: '谁' }], byName)).toThrow('不在频道里')
    expect(() => planSteps([], byName)).toThrow('非空')
  })
})
