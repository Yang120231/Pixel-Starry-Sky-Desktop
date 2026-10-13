import { describe, expect, it } from 'vitest'
import type { AgentRun, Item, WorkflowRun } from '@pixelsky/protocol'
import { ago, endedAt, partitionRuns, turnToolUseIds, type PartitionOptions } from './traceHistory'

const agent = (id: string, state: string, over: Partial<AgentRun> = {}): AgentRun => ({
  id,
  label: id,
  type: '',
  model: '',
  state,
  startedAt: 1000,
  durationMs: 100,
  tokens: 10,
  toolCalls: 0,
  phase: null,
  prompt: '',
  result: '',
  toolUseId: null,
  ...over,
})
const wf = (id: string, status: string, over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id,
  name: id,
  description: '',
  status,
  startedAt: 1000,
  durationMs: 100,
  tokens: 100,
  toolCalls: 0,
  phases: [],
  agents: [],
  toolUseId: null,
  ...over,
})
const opts = (over: Partial<PartitionOptions> = {}): PartitionOptions => ({
  now: 9999,
  seen: new Set(),
  clearedAt: null,
  onlyTurn: false,
  turnToolUseIds: new Set(),
  ...over,
})
const ids = (es: { run: { id: string } }[]) => es.map(e => e.run.id)

describe('endedAt', () => {
  it('开始 + 用时；用时不大于 0 时是开始时间', () => {
    expect(endedAt({ startedAt: 10, durationMs: 5 })).toBe(15)
    expect(endedAt({ startedAt: 10, durationMs: 0 })).toBe(10)
    expect(endedAt({ startedAt: 10, durationMs: -3 })).toBe(10)
  })
})

describe('partitionRuns', () => {
  it('空输入', () => {
    const p = partitionRuns({ workflows: [], agents: [] }, opts())
    expect(p).toEqual({
      running: { workflows: [], agents: [] },
      attention: [],
      history: [],
      clearedCount: 0,
      totalTokens: 0,
    })
  })

  it('运行中 / 排队（含没有 id）进 running，保持原顺序', () => {
    const p = partitionRuns(
      {
        workflows: [wf('w1', 'running')],
        agents: [agent('a1', 'running'), agent('', 'pending'), agent('a3', 'queued')],
      },
      opts(),
    )
    expect(p.running.workflows.map(w => w.id)).toEqual(['w1'])
    expect(p.running.agents.map(a => a.id)).toEqual(['a1', '', 'a3'])
    expect(p.history).toEqual([])
  })

  it('done 进 history；failed / stopped 未看过进 attention，看过或没有 id 进 history', () => {
    const p = partitionRuns(
      {
        workflows: [wf('w1', 'completed')],
        agents: [agent('f1', 'failed'), agent('s1', 'stopped'), agent('f2', 'failed'), agent('', 'failed')],
      },
      opts({ seen: new Set(['f2']) }),
    )
    expect(ids(p.attention).sort()).toEqual(['f1', 's1'])
    expect(ids(p.history).sort()).toEqual(['', 'f2', 'w1'])
  })

  it('按结束时间新→旧', () => {
    const p = partitionRuns(
      {
        workflows: [],
        agents: [
          agent('a', 'done', { startedAt: 100 }),
          agent('b', 'done', { startedAt: 300 }),
          agent('c', 'done', { startedAt: 200 }),
          agent('x', 'failed', { startedAt: 10 }),
          agent('y', 'failed', { startedAt: 50 }),
        ],
      },
      opts(),
    )
    expect(ids(p.history)).toEqual(['b', 'c', 'a'])
    expect(ids(p.attention)).toEqual(['y', 'x'])
  })

  it('清空：endedAt <= clearedAt 的藏起来并计数，之后的保留；attention 不受影响', () => {
    const p = partitionRuns(
      {
        workflows: [],
        agents: [
          agent('old', 'done', { startedAt: 100 }),
          agent('edge', 'done', { startedAt: 400, durationMs: 100 }),
          agent('new', 'done', { startedAt: 501 }),
          agent('bad', 'failed', { startedAt: 10 }),
        ],
      },
      opts({ clearedAt: 500 }),
    )
    expect(ids(p.history)).toEqual(['new'])
    expect(p.clearedCount).toBe(2)
    expect(ids(p.attention)).toEqual(['bad'])
  })

  it('只看这一轮：toolUseId 为 null 或不在集合里的不进 history；clearedCount 不管它', () => {
    const p = partitionRuns(
      {
        workflows: [wf('w', 'done', { toolUseId: 't1' })],
        agents: [
          agent('in', 'done', { toolUseId: 't2' }),
          agent('nul', 'done'),
          agent('out', 'done', { toolUseId: 't9' }),
          agent('cl', 'done', { startedAt: 1, toolUseId: 't9' }),
          agent('bad', 'failed'),
        ],
      },
      opts({ onlyTurn: true, turnToolUseIds: new Set(['t1', 't2']), clearedAt: 200 }),
    )
    expect(ids(p.history).sort()).toEqual(['in', 'w'])
    expect(p.clearedCount).toBe(1)
    expect(ids(p.attention)).toEqual(['bad'])
  })

  it('totalTokens 合计全部，清空不影响', () => {
    const p = partitionRuns(
      {
        workflows: [wf('w', 'done', { tokens: 100 })],
        agents: [agent('a', 'done', { tokens: 5 }), agent('b', 'running', { tokens: 7 })],
      },
      opts({ clearedAt: 1e9 }),
    )
    expect(p.totalTokens).toBe(112)
  })
})

describe('turnToolUseIds', () => {
  const user = (id: string, mode?: 'guidance'): Item => ({ kind: 'user', id, text: id, createdAt: 0, mode })
  const tool = (id: string): Item => ({
    kind: 'tool',
    id,
    tool: 'task',
    name: 'Agent',
    title: '',
    output: '',
    status: 'completed',
  })
  const say: Item = { kind: 'assistant', id: 'as', text: '', status: 'completed' }

  it('最后一条用户消息之后的工具调用', () => {
    expect([...turnToolUseIds([user('u1'), tool('t1'), user('u2'), say, tool('t2')])]).toEqual(['t2'])
  })
  it('引导消息不算', () => {
    expect([...turnToolUseIds([user('u1'), tool('t1'), user('g', 'guidance'), tool('t2')])].sort()).toEqual([
      't1',
      't2',
    ])
  })
  it('没有用户消息时是全部', () => {
    expect([...turnToolUseIds([tool('t1'), say, tool('t2')])].sort()).toEqual(['t1', 't2'])
    expect(turnToolUseIds([]).size).toBe(0)
  })
})

describe('ago', () => {
  const now = 10 * 86400_000
  it('按秒、分、时、天写「多久前」', () => {
    expect(ago(now - 30_000, now)).toBe('刚刚')
    expect(ago(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(ago(now - 3 * 3600_000, now)).toBe('3 小时前')
    expect(ago(now - 2 * 86400_000, now)).toBe('2 天前')
  })
})
