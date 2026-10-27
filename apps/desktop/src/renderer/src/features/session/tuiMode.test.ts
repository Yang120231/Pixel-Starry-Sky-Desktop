import { describe, expect, it } from 'vitest'
import { tuiActive, tuiBlockKey, tuiDisabledReason, tuiModeOf, tuiToggleVisible } from './tuiMode'
import type { SessionRecord, SessionSnapshot } from '@pixelsky/protocol'

function snap(partial: Partial<SessionRecord> & Pick<SessionRecord, 'engine'>): SessionSnapshot {
  const record = {
    id: 's1',
    projectId: 'p',
    cwd: '/tmp',
    engineSessionId: 'eng-1',
    title: 't',
    createdAt: 1,
    updatedAt: 1,
    lastOutcome: null,
    model: null,
    effort: null,
    permissionMode: 'ask' as const,
    ultracode: false,
    fast: false,
    thinkingSummaries: false,
    ...partial,
  }
  return {
    record,
    items: [],
    state: 'idle',
    queue: [],
    pending: [],
    tasks: [],
    subagents: [],
    runs: null,
    queuePaused: false,
  } as unknown as SessionSnapshot
}

describe('tuiMode helpers', () => {
  it('treats tui marker as active even with empty terminalId', () => {
    const record = snap({ engine: 'claude', tui: { terminalId: '', since: 1 } }).record
    expect(tuiActive(record)).toBe(true)
    expect(tuiModeOf(record)).toBe('terminal')
  })

  it('does not gray when already in tui mode', () => {
    expect(tuiDisabledReason(snap({ engine: 'claude', tui: { terminalId: 't1', since: 1 } }))).toBeNull()
  })

  it('does not gray pending rewind/fork (prepareTui flushes)', () => {
    expect(tuiDisabledReason(snap({ engine: 'claude', pendingRewind: 'u1' }))).toBeNull()
    expect(tuiDisabledReason(snap({ engine: 'claude', pendingFork: { from: 'a', at: 'b' } }))).toBeNull()
  })

  it('shows toggle for claude/codex, not pixel', () => {
    expect(tuiToggleVisible(snap({ engine: 'claude' }).record)).toBe(true)
    expect(tuiToggleVisible(snap({ engine: 'codex' }).record)).toBe(true)
    expect(tuiToggleVisible(snap({ engine: 'pixel' }).record)).toBe(false)
    expect(tuiToggleVisible(null)).toBe(false)
  })

  it('主进程的原因代码换成文字；不认识的当能切', () => {
    expect(tuiBlockKey('liveTerminal')).toBe('session.tui.disabledLiveTerminal')
    expect(tuiBlockKey('liveOther')).toBe('session.tui.disabledLiveOther')
    expect(tuiBlockKey('busy')).toBe('session.tui.disabledBusy')
    expect(tuiBlockKey('later-code')).toBeNull()
    expect(tuiBlockKey(null)).toBeNull()
  })

  it('后台子智能体还在跑时灰掉（切过去会把它们停掉）', () => {
    const s = snap({ engine: 'claude' })
    const running = { ...s, subagents: [{ id: 'a', name: '甲', status: 'running', background: true }] }
    expect(tuiDisabledReason(running as unknown as typeof s)).toBe('session.tui.disabledBusy')
  })
})
