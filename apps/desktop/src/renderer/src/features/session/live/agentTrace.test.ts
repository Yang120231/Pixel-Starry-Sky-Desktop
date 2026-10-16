import { describe, expect, it } from 'vitest'
import type { AgentRun, WorkflowRun } from '@pixelsky/protocol'
import { PHASE_ROWS, phaseOpenByDefault, phaseRows, phaseState, phaseViews, runState, shortModel } from './agentTrace'

const agent = (id: string, state: string, phase: number | null = 0, model = 'opus-5-5'): AgentRun => ({
  id,
  label: id,
  type: '',
  model,
  state,
  startedAt: 0,
  durationMs: 0,
  tokens: 0,
  toolCalls: 0,
  phase,
  prompt: '',
  result: '',
  toolUseId: null,
})

describe('runState', () => {
  it('Codex 的子智能体状态词归类', () => {
    for (const s of ['errored', 'notFound', 'not_found']) expect(runState(s)).toBe('failed')
    expect(runState('shutdown')).toBe('stopped')
    for (const s of ['pendingInit', 'pending_init', 'pending']) expect(runState(s)).toBe('queued')
    expect(runState('')).toBe('done')
  })
})

describe('shortModel', () => {
  it('去掉 claude- 前缀', () => {
    expect(shortModel('claude-sonnet-5-5')).toBe('sonnet-5-5')
  })
  it('去掉厂商前缀和 [1m] 标记（GitHub #38）', () => {
    expect(shortModel('anthropic/claude-v4.1flash[1m]')).toBe('v4.1flash')
    expect(shortModel('openrouter/moonshotai/kimi-k3')).toBe('kimi-k3')
    expect(shortModel('claude-opus-5-5[1M]')).toBe('opus-5-5')
  })
  it('其他名字原样；去完为空时用原名', () => {
    expect(shortModel('gpt-5.5')).toBe('gpt-5.5')
    expect(shortModel('')).toBe('')
    expect(shortModel('anthropic/')).toBe('anthropic/')
  })
})

describe('编排的阶段', () => {
  it('阶段状态：失败 > 跑着 > 全没开始 > 中间等着算跑着 > 停掉 > 完成', () => {
    expect(phaseState([agent('a', 'completed'), agent('b', 'failed'), agent('c', 'running')])).toBe('failed')
    expect(phaseState([agent('a', 'completed'), agent('b', 'running')])).toBe('running')
    expect(phaseState([agent('a', 'pending'), agent('b', 'queued')])).toBe('queued')
    expect(phaseState([agent('a', 'completed'), agent('b', 'queued')])).toBe('running')
    expect(phaseState([agent('a', 'completed'), agent('b', 'stopped')])).toBe('stopped')
    expect(phaseState([agent('a', 'completed')])).toBe('done')
  })

  it('跑着的和有失败的阶段默认展开', () => {
    expect(phaseOpenByDefault('running')).toBe(true)
    expect(phaseOpenByDefault('failed')).toBe(true)
    expect(phaseOpenByDefault('done')).toBe(false)
    expect(phaseOpenByDefault('queued')).toBe(false)
  })

  it('每个阶段：圆点、完成数（失败不算）、都用同一个模型时写在表头', () => {
    const run = {
      phases: [
        { index: 0, title: 'Review' },
        { index: 1, title: 'Verify' },
      ],
      agents: [
        agent('r1', 'completed', 0),
        agent('r2', 'running', 0),
        agent('v1', 'completed', 1, 'opus-5-5'),
        agent('v2', 'failed', 1, 'sonnet-5-5'),
      ],
    } as unknown as WorkflowRun
    const [review, verify] = phaseViews(run)
    expect(review).toMatchObject({
      title: 'Review',
      state: 'running',
      done: 1,
      dots: ['done', 'running'],
      model: 'opus-5-5',
    })
    expect(verify).toMatchObject({ title: 'Verify', state: 'failed', done: 1, model: '' })
  })

  it('阶段里超过 8 个：先列跑着、失败的，再按先后补满，其余收起；all 时全列', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      agent(`a${i}`, i === 10 ? 'failed' : i === 11 ? 'running' : 'completed'),
    )
    const { shown, hidden } = phaseRows(many, false)
    expect(shown).toHaveLength(PHASE_ROWS)
    expect(hidden).toBe(4)
    expect(shown.map(a => a.id)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a10', 'a11'])
    expect(phaseRows(many, true).hidden).toBe(0)
    expect(phaseRows(many.slice(0, 3), false).shown).toHaveLength(3)
  })
})
