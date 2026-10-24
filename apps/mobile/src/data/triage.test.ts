import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@pixelsky/protocol'
import { nextInTriage, startTriage, triagePosition } from './triage'

const s = (
  id: string,
  updatedAt: number,
  state: SessionSummary['state'] = 'waiting',
  archivedAt: number | null = null,
) => ({ record: { id, title: id, projectId: 'p', updatedAt, engine: 'claude', archivedAt }, state }) as SessionSummary

describe('逐个处理等你的会话', () => {
  it('打开时记下等你的会话，新的在前；没有等你的返回 null', () => {
    expect(startTriage([s('a', 1), s('b', 3), s('c', 2, 'running'), s('d', 4, 'waiting', 9)])).toEqual({
      ids: ['b', 'a'],
    })
    expect(startTriage([s('a', 1, 'idle')])).toBeNull()
  })

  it('下一个只找还在等你的，电脑上处理掉的跳过', () => {
    const triage = { ids: ['a', 'b', 'c'] }
    expect(nextInTriage(triage, 'a', [s('a', 1, 'running'), s('b', 2), s('c', 3)])).toBe('b')
    expect(nextInTriage(triage, 'a', [s('b', 2, 'running'), s('c', 3)])).toBe('c')
    expect(nextInTriage(triage, 'c', [s('a', 1), s('b', 2)])).toBeNull()
    // 不在这一批里：从头找
    expect(nextInTriage(triage, 'x', [s('b', 2)])).toBe('b')
  })

  it('第几个 / 一共几个', () => {
    expect(triagePosition({ ids: ['a', 'b', 'c'] }, 'b')).toEqual({ index: 2, total: 3 })
    expect(triagePosition({ ids: ['a'] }, 'x')).toBeNull()
  })
})
