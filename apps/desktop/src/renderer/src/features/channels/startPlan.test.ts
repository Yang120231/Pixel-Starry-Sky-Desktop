import { describe, expect, it } from 'vitest'
import type { FlowStepInput } from '../../../../shared/types/channels'
import { assignSteps, effortEdge, finalSteps } from './startPlan'

const step = (id: string, memberId: string, patch: Partial<FlowStepInput> = {}): FlowStepInput => ({
  id,
  title: `做 ${id}`,
  memberId,
  deps: [],
  kind: 'work',
  ...patch,
})

describe('assignSteps', () => {
  it('keeps checked members and reassigns unchecked ones to the least loaded', () => {
    const plan = assignSteps([step('s1', 'a'), step('s2', 'b'), step('s3', 'b'), step('s4', 'c')], ['a', 'c'])
    expect(plan.map(p => [p.step.id, p.to, p.moved])).toEqual([
      ['s1', 'a', false],
      ['s2', 'a', true],
      ['s3', 'c', true],
      ['s4', 'c', false],
    ])
  })

  it('gives everything to the only checked AI', () => {
    const plan = assignSteps(
      [step('s1', 'a'), step('s2', 'b'), step('s3', 'b', { kind: 'review', target: 's1', deps: ['s1'] })],
      ['b'],
    )
    expect(plan.map(p => p.to)).toEqual(['b', 'b', 'b'])
    expect(plan.map(p => p.moved)).toEqual([true, false, false])
  })

  it('prefers a different member for a review than the reviewed step', () => {
    const plan = assignSteps(
      [step('s1', 'a'), step('s2', 'a'), step('s3', 'x', { kind: 'review', target: 's1', deps: ['s1'] })],
      ['a', 'b'],
    )
    // b 步骤更少本来就会选 b；把 b 塞满也不交给 a 自己审自己
    expect(plan[2].to).toBe('b')
    const busy = assignSteps(
      [step('s1', 'a'), step('s2', 'b'), step('s3', 'b'), step('s4', 'x', { kind: 'review', target: 's1' })],
      ['a', 'b'],
    )
    expect(busy[3].to).toBe('b')
  })

  it('drops steps with empty titles and keeps their dependencies', () => {
    const plan = assignSteps(
      [step('s1', 'a'), step('s2', 'a', { title: '  ', deps: ['s1'] }), step('s3', 'a', { deps: ['s2'] })],
      ['a'],
    )
    expect(plan.map(p => p.step.id)).toEqual(['s1', 's3'])
    expect(plan[1].step.deps).toEqual(['s1'])
  })

  it('assigns nobody when no AI is checked', () => {
    const plan = assignSteps([step('s1', 'a'), step('s2', 'b')], [])
    expect(plan.map(p => p.to)).toEqual([null, null])
    expect(finalSteps(plan, () => ({}))).toEqual([])
  })

  it('prefers idle members on ties', () => {
    const plan = assignSteps([step('s1', 'x')], ['a', 'b'], new Set(['a']))
    expect(plan[0].to).toBe('b')
  })
})

describe('finalSteps / effortEdge', () => {
  it('applies the assignee and settings, dropping unset ones', () => {
    const plan = assignSteps([step('s1', 'x', { settings: { effort: 'high', fast: true } })], ['a'])
    expect(finalSteps(plan, () => ({ effort: 'low', model: undefined, fast: true }))).toEqual([
      { id: 's1', title: '做 s1', memberId: 'a', deps: [], kind: 'work', settings: { effort: 'low', fast: true } },
    ])
    expect(finalSteps(plan, () => ({}))[0]).not.toHaveProperty('settings')
  })

  it('picks the lowest and highest effort in protocol order', () => {
    expect(effortEdge(['high', 'low', 'xhigh', 'medium'], 'low')).toBe('low')
    expect(effortEdge(['high', 'low', 'xhigh', 'medium'], 'high')).toBe('xhigh')
    expect(effortEdge(undefined, 'high')).toBeUndefined()
  })
})
