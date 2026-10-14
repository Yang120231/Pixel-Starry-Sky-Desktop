import { describe, expect, it } from 'vitest'
import type { Item, SessionSnapshot } from '@pixelsky/protocol'

import { keptAgents, lastTurnInterrupted, stopTargets } from './subagentStop'

const user = (id: string, mode?: 'guidance'): Item => ({
  kind: 'user',
  id,
  text: '',
  createdAt: 0,
  ...(mode ? { mode } : {}),
})
const stats = (outcome: 'completed' | 'interrupted'): Item =>
  ({ kind: 'turn_stats', id: 's', turnId: 't', outcome, usage: {} }) as unknown as Item

function snap(engine: string, items: Item[], state = 'idle'): SessionSnapshot {
  return {
    record: { engine },
    state,
    items,
    subagents: [{ id: 'a', label: '甲', status: 'running', message: null, background: true }],
    tasks: [{ id: 'w', kind: 'local_workflow', description: '编排', message: null }],
  } as unknown as SessionSnapshot
}

describe('停止时连同后台子智能体', () => {
  it('stopTargets 按引擎能力：claude 有，codex / pixel 没有', () => {
    expect(stopTargets(snap('claude', [])).map(t => t.id)).toEqual(['a', 'w'])
    expect(stopTargets(snap('codex', []))).toEqual([])
    expect(stopTargets(snap('pixel', []))).toEqual([])
    expect(stopTargets(null)).toEqual([])
  })
  it('lastTurnInterrupted：完成 / 中断 / 之后又有新的用户消息', () => {
    expect(lastTurnInterrupted([user('u'), stats('completed')])).toBe(false)
    expect(lastTurnInterrupted([user('u'), stats('interrupted')])).toBe(true)
    expect(lastTurnInterrupted([user('u'), stats('interrupted'), user('u2')])).toBe(false)
    expect(lastTurnInterrupted([user('u'), stats('interrupted'), user('g', 'guidance')])).toBe(true)
  })
  it('keptAgents：空闲 + 被中断 + 有后台才算', () => {
    expect(keptAgents(snap('claude', [user('u'), stats('interrupted')])).length).toBe(2)
    expect(keptAgents(snap('claude', [user('u'), stats('interrupted')], 'running'))).toEqual([])
    expect(keptAgents(snap('claude', [user('u'), stats('completed')]))).toEqual([])
    expect(keptAgents(snap('codex', [user('u'), stats('interrupted')]))).toEqual([])
  })
})
