import { describe, expect, it } from 'vitest'
import type { ChannelFlow } from '../../../shared/types/channels'
import { cleanLimits, cleanSteps, copyPlan, draftProblem, limitHit, planSteps, startable, withStep } from './flow'

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

describe('流程第二批的纯函数（docs/ui/channels-pipeline.md §6）', () => {
  const flowOf = (steps: ReturnType<typeof cleanSteps>, patch: Partial<ChannelFlow> = {}): ChannelFlow => ({
    title: 't',
    status: 'running',
    steps,
    maxRejects: 3,
    ...patch,
  })

  it('关卡：清洗保留 gate；等你确认的一步不算交付', () => {
    const steps = cleanSteps([
      { id: 's1', title: 'a', memberId: 'a', kind: 'work', gate: true },
      { id: 's2', title: 'b', memberId: 'b', deps: ['s1'], kind: 'work', gate: 'yes' },
    ])
    expect(steps[0].gate).toBe(true)
    expect(steps[1].gate).toBeUndefined()
    const f = withStep(flowOf(steps), 's1', { status: 'gated' })
    expect(startable(f)).toEqual([])
  })

  it('护栏：清洗截到范围、空是不限；按计数起点判断', () => {
    expect(cleanLimits(undefined)).toBeUndefined()
    expect(cleanLimits({ rounds: 999, minutes: 1 })).toEqual({ rounds: 200, minutes: 5 })
    expect(cleanLimits({ rounds: '', minutes: null })).toEqual({ rounds: null, minutes: null })
    const f = flowOf([], { limits: { rounds: 5, minutes: 10 }, since: { at: 0, rounds: 2 } })
    expect(limitHit(f, 6, 0)).toBeNull()
    expect(limitHit(f, 7, 0)).toBe('rounds')
    expect(limitHit(f, 3, 10 * 60_000)).toBe('time')
    expect(limitHit({ ...f, limits: null }, 99, 1e9)).toBeNull()
  })

  it('副本规划：串行不建；同时开始的各建一个；单依赖沿用；同一前驱分两路各建；汇合回主目录；开关关掉不建', () => {
    const steps = cleanSteps([
      { id: 's1', title: 'a', memberId: 'a', kind: 'work' },
      { id: 's2', title: 'b', memberId: 'b', kind: 'work' },
      { id: 's3', title: 'c', memberId: 'c', deps: ['s1'], kind: 'work' },
      { id: 's4', title: 'd', memberId: 'a', deps: ['s1', 's2'], kind: 'summary' },
    ])
    const f = flowOf(steps)
    // 只有 s1 开始：主目录
    expect(copyPlan(f, 'abcdef12', 's1', ['s1'])).toEqual({ kind: 'main', merge: [] })
    // s1、s2 同时开始：各建一个，基于主目录
    expect(copyPlan(f, 'abcdef12', 's1', ['s1', 's2'])).toEqual({
      kind: 'new',
      name: 'flow-abcdef-a',
      branch: 'pixelsky/flow-abcdef-a',
      base: null,
    })
    const copy = { id: 'c1', branch: 'pixelsky/flow-abcdef-a', path: '/c1' }
    const done = withStep(withStep(f, 's1', { status: 'delivered', copy }), 's2', {
      status: 'delivered',
      copy: { id: 'c2', branch: 'pixelsky/flow-abcdef-b', path: '/c2' },
    })
    // s3 只依赖 s1：沿用它的副本
    expect(copyPlan(done, 'abcdef12', 's3', ['s3'])).toEqual({ kind: 'reuse', copy })
    // s3 和另一个也从 s1 分出来的步骤同时开始：各建一个，基于 s1 的分支
    const fork = flowOf([...done.steps, { ...done.steps[2], id: 's5' }])
    expect(copyPlan(fork, 'abcdef12', 's3', ['s3', 's5'])).toMatchObject({ kind: 'new', base: copy.branch })
    // s4 依赖两个副本：主目录合并
    expect(copyPlan(done, 'abcdef12', 's4', ['s4'])).toEqual({ kind: 'main', merge: ['s1', 's2'] })
    // 开关关掉：同时开始也在主目录
    expect(copyPlan({ ...f, isolate: false }, 'abcdef12', 's1', ['s1', 's2'])).toEqual({ kind: 'main', merge: [] })
  })
})
