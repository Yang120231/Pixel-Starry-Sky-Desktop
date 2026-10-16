import { describe, expect, it } from 'vitest'
import type { AgentRun, Item, TodoStep } from '@pixelsky/protocol'
import { activeStep, currentPlan, progressAgents, turnKey } from './progressData'

const user = (id: string, mode?: 'guidance'): Item => ({ kind: 'user', id, text: id, createdAt: 0, mode })
const steps = (...s: TodoStep['status'][]): TodoStep[] => s.map((status, i) => ({ text: `step ${i}`, status }))
const todo = (id: string, s: TodoStep[]): Item => ({ kind: 'todo', id, steps: s, status: 'completed' })
const reply = (id: string): Item => ({ kind: 'assistant', id, text: 'ok', status: 'completed' })

describe('turnKey', () => {
  it('取最后一条非引导的用户消息', () => {
    expect(turnKey([user('u1'), reply('a'), user('u2'), user('g', 'guidance')])).toBe('u2')
    expect(turnKey([reply('a')])).toBe('')
  })
})

describe('currentPlan', () => {
  it('取最近一轮里最新的一条待办，并数出完成的步骤', () => {
    const items = [user('u1'), todo('t1', steps('pending', 'pending')), todo('t2', steps('completed', 'in_progress'))]
    expect(currentPlan(items, true)).toEqual({
      id: 't2',
      steps: items[2].kind === 'todo' ? items[2].steps : [],
      done: 1,
    })
  })

  it('引导消息不算新的一轮', () => {
    const items = [user('u1'), todo('t1', steps('completed')), user('g', 'guidance')]
    expect(currentPlan(items, false)?.id).toBe('t1')
  })

  it('上一轮的计划：空闲时不显示；运行中且没做完时继续显示', () => {
    const unfinished = [user('u1'), todo('t1', steps('completed', 'pending')), user('u2')]
    expect(currentPlan(unfinished, false)).toBeNull()
    expect(currentPlan(unfinished, true)?.id).toBe('t1')
    const finished = [user('u1'), todo('t1', steps('completed')), user('u2')]
    expect(currentPlan(finished, true)).toBeNull()
  })

  it('空的待办跳过，没有待办时为 null', () => {
    expect(currentPlan([user('u1'), todo('t1', steps('pending')), todo('t2', [])], false)?.id).toBe('t1')
    expect(currentPlan([user('u1'), reply('a')], true)).toBeNull()
  })
})

describe('progressAgents', () => {
  const run: AgentRun = {
    id: 'a1',
    label: 'explore',
    type: 'Explore',
    model: 'claude-haiku-5-5',
    state: 'running',
    startedAt: 1000,
    durationMs: 0,
    tokens: 0,
    toolCalls: 0,
    phase: null,
    prompt: '',
    result: '',
    toolUseId: 'tu1',
  }

  it('合并追踪里的模型、类型和开始时间', () => {
    const [a] = progressAgents([{ id: 'a1', label: '读码', status: 'running', message: 'Grep' }], {
      workflows: [],
      agents: [run],
    })
    expect(a).toEqual({
      id: 'a1',
      label: '读码',
      state: 'running',
      model: 'claude-haiku-5-5',
      type: 'Explore',
      message: 'Grep',
      startedAt: 1000,
      durationMs: 0,
      background: false,
      steps: [],
    })
  })

  it('带上摘要、结果、任务说明（追踪里的 prompt 兜底）和它调用过的工具', () => {
    const tool: Item = {
      kind: 'tool',
      id: 't1',
      tool: 'read',
      name: 'Read',
      title: 'a.ts',
      output: '',
      status: 'completed',
      subagentCall: 'tu1',
    }
    const [a] = progressAgents(
      [{ id: 'a1', label: '读码', status: 'running', message: '摘要', summary: '摘要' }],
      { workflows: [], agents: [{ ...run, prompt: '读一遍 a.ts' }] },
      [tool, { ...tool, id: 't2', subagentCall: 'other' }],
    )
    expect(a).toMatchObject({ summary: '摘要', task: '读一遍 a.ts' })
    expect(a.steps.map(s => s.id)).toEqual(['t1'])
  })

  it('没有追踪数据时用子智能体条自己的信息', () => {
    const [a] = progressAgents([{ id: 'abcdef123456', label: '', status: 'completed', message: null }], undefined)
    expect(a).toMatchObject({ label: 'abcdef12', state: 'done', model: '', type: '', startedAt: 0 })
  })
})

describe('activeStep', () => {
  it('进行中的第一个步骤', () => {
    expect(activeStep(steps('completed', 'in_progress', 'pending'))).toBe(1)
    expect(activeStep(steps('completed', 'pending'))).toBe(-1)
  })
})
