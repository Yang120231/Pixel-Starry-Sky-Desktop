import { describe, expect, it } from 'vitest'
import type { AgentRun, EngineEvent } from '@pixelsky/protocol'
import { CodexTranslator } from '../src/codex/translate'

describe('Codex 子智能体：这一轮结束时的收尾', () => {
  const spawn = (id: string, thread: string) => ({
    type: 'subAgentActivity',
    id,
    kind: 'started',
    agentThreadId: thread,
    agentPath: `/root/${thread}`,
  })
  const subagents = (events: EngineEvent[]) =>
    events.findLast(e => e.type === 'subagents')?.subagents.map(s => [s.id, s.status])

  it('进程退出 / 中断 / 失败：还在跑的标成已中断并推给界面，已跑完的不动', () => {
    for (const outcome of ['failed', 'interrupted'] as const) {
      const events: EngineEvent[] = [],
        agents = new Map<string, AgentRun>(),
        translator = new CodexTranslator(e => events.push(e), undefined, agents)
      translator.item(spawn('s1', 'child-a'), true)
      translator.item(spawn('s2', 'child-b'), true)
      translator.item({ type: 'subAgentActivity', id: 'done-b', kind: 'completed', agentThreadId: 'child-b' }, true)
      translator.finish(outcome)
      expect(agents.get('child-a')).toMatchObject({ state: 'interrupted', toolUseId: 'cx-s1' })
      expect(agents.get('child-b')).toMatchObject({ state: 'completed' })
      expect(subagents(events)).toEqual([
        ['child-a', 'interrupted'],
        ['child-b', 'completed'],
      ])
      expect(events.findLast(e => e.type === 'runs')?.runs.agents.map(a => a.state)).toEqual([
        'interrupted',
        'completed',
      ])
    }
  })

  it('正常结束不动子智能体：它们可能在主轮结束后才跑完，之后的「跑完」事件照常更新', () => {
    const events: EngineEvent[] = [],
      agents = new Map<string, AgentRun>(),
      translator = new CodexTranslator(e => events.push(e), undefined, agents)
    translator.item(spawn('s1', 'child-a'), true)
    const before = events.length
    translator.finish('completed')
    expect(agents.get('child-a')).toMatchObject({ state: 'running' })
    expect(events.slice(before).some(e => e.type === 'runs' || e.type === 'subagents')).toBe(false)
  })

  it('已被标成已中断的子智能体后来又跑完：状态改回已完成', () => {
    const agents = new Map<string, AgentRun>(),
      translator = new CodexTranslator(() => {}, undefined, agents)
    translator.item(spawn('s1', 'child-a'), true)
    translator.finish('interrupted')
    expect(agents.get('child-a')).toMatchObject({ state: 'interrupted' })
    translator.item({ type: 'subAgentActivity', id: 'done-a', kind: 'completed', agentThreadId: 'child-a' }, true)
    expect(agents.get('child-a')).toMatchObject({ state: 'completed' })
  })

  it('没有子智能体或都已跑完时不发多余的更新', () => {
    const events: EngineEvent[] = [],
      translator = new CodexTranslator(e => events.push(e))
    translator.finish('failed')
    expect(events).toEqual([])
  })
})
