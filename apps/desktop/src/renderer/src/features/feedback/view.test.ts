import { describe, expect, it } from 'vitest'
import type { FeedbackMessage, FeedbackSummary, FeedbackThread } from '../../../../shared/types/feedback'
import {
  badgeText,
  fieldErrors,
  filterThreads,
  newReplyIndex,
  progressSteps,
  segmentCounts,
  shortId,
  statusKind,
} from './view'

const summary = (id: string, over: Partial<FeedbackSummary> = {}): FeedbackSummary => ({
  id,
  type: 'bug',
  title: `Title ${id}`,
  status: 'open',
  createdAt: 1,
  updatedAt: 2,
  unread: false,
  preview: 'some preview',
  previewAuthor: 'user',
  teamSeen: false,
  teamSeenAt: null,
  working: false,
  workingAt: null,
  messageCount: 1,
  attachments: { logs: 0, images: 0 },
  ...over,
})

describe('statusKind', () => {
  it('maps the five labels in priority order', () => {
    expect(statusKind(summary('a', { status: 'closed', working: true }))).toBe('closed')
    expect(statusKind(summary('a', { status: 'replied', working: true }))).toBe('replied')
    expect(statusKind(summary('a', { working: true, teamSeen: true }))).toBe('working')
    expect(statusKind(summary('a', { teamSeen: true }))).toBe('seen')
    expect(statusKind(summary('a'))).toBe('waiting')
  })
})

const thread = (over: Partial<FeedbackThread> = {}): FeedbackThread => ({
  ...summary('t', { createdAt: 100 }),
  closedBy: null,
  closedAt: null,
  ...over,
})
const msg = (author: 'user' | 'team', createdAt: number, kind: FeedbackMessage['kind'] = 'message') => ({
  author,
  kind,
  createdAt,
})

describe('progressSteps', () => {
  it('only submitted on a fresh thread', () => {
    const steps = progressSteps(thread(), [msg('user', 100)])
    expect(steps.map(s => s.state)).toEqual(['done', 'todo', 'todo', 'todo', 'todo'])
    expect(steps[0].at).toBe(100)
  })
  it('seen and working carry their own times', () => {
    const steps = progressSteps(thread({ teamSeen: true, teamSeenAt: 150, working: true, workingAt: 160 }), [
      msg('user', 100),
    ])
    expect(steps.map(s => s.state)).toEqual(['done', 'done', 'done', 'todo', 'todo'])
    expect(steps.map(s => s.at)).toEqual([100, 150, 160, null, null])
  })
  it('skipped steps count as done without a time', () => {
    const steps = progressSteps(thread({ status: 'replied' }), [msg('user', 100), msg('team', 200)])
    expect(steps.map(s => s.state)).toEqual(['done', 'done', 'done', 'done', 'todo'])
    expect(steps.map(s => s.at)).toEqual([100, null, null, 200, null])
  })
  it('closed without a reply fills everything before it', () => {
    const steps = progressSteps(thread({ status: 'closed', closedAt: 300 }), [
      msg('user', 100),
      msg('user', 300, 'closed'),
    ])
    expect(steps.every(s => s.state === 'done')).toBe(true)
    expect(steps[3].at).toBeNull()
    expect(steps[4].at).toBe(300)
  })
  it('never shows a step later than a step after it', () => {
    // 团队 13:34 回复后又在 13:36 回复，team_seen_at 跟着挪到 13:36；转交让 working_at 也晚于第一次回复
    const steps = progressSteps(
      thread({ status: 'replied', teamSeen: true, teamSeenAt: 360, working: true, workingAt: 330 }),
      [msg('user', 100), msg('team', 340), msg('team', 360)],
    )
    expect(steps.map(s => s.at)).toEqual([100, 330, 330, 340, null])
  })
  it('ignores team close events when finding the first reply', () => {
    const steps = progressSteps(thread(), [msg('user', 100), msg('team', 150, 'closed')])
    expect(steps[3].state).toBe('todo')
  })
})

describe('newReplyIndex', () => {
  const list = [msg('user', 1), msg('team', 2), msg('team', 3)]
  it('puts the rule before the first team message after the last user message', () => {
    expect(newReplyIndex(list, true)).toBe(1)
    expect(newReplyIndex([msg('user', 1), msg('team', 2), msg('user', 3), msg('team', 4)], true)).toBe(3)
  })
  it('is off when read or when the team has not answered the last user message', () => {
    expect(newReplyIndex(list, false)).toBe(-1)
    expect(newReplyIndex([msg('team', 1), msg('user', 2)], true)).toBe(-1)
  })
  it('skips status events', () => {
    expect(newReplyIndex([msg('user', 1), msg('team', 2, 'closed'), msg('team', 3)], true)).toBe(2)
  })
})

describe('filterThreads', () => {
  const all = [
    summary('a', { title: 'Terminal split', type: 'feature', preview: 'wish for panes' }),
    summary('b', { title: 'Freeze', status: 'closed', preview: 'conversation hangs' }),
    summary('c', { title: 'Invoice', type: 'other', status: 'replied' }),
  ]
  it('segments', () => {
    expect(filterThreads(all, { segment: 'active', type: 'all', query: '' }).map(t => t.id)).toEqual(['a', 'c'])
    expect(filterThreads(all, { segment: 'closed', type: 'all', query: '' }).map(t => t.id)).toEqual(['b'])
    expect(filterThreads(all, { segment: 'all', type: 'all', query: '' })).toHaveLength(3)
    expect(segmentCounts(all)).toEqual({ active: 2, closed: 1, all: 3 })
  })
  it('type and search (title + preview, case-insensitive, all words)', () => {
    expect(filterThreads(all, { segment: 'all', type: 'feature', query: '' }).map(t => t.id)).toEqual(['a'])
    expect(filterThreads(all, { segment: 'all', type: 'all', query: 'HANGS' }).map(t => t.id)).toEqual(['b'])
    expect(filterThreads(all, { segment: 'all', type: 'all', query: 'terminal panes' }).map(t => t.id)).toEqual(['a'])
    expect(filterThreads(all, { segment: 'all', type: 'all', query: 'terminal hangs' })).toEqual([])
  })
})

describe('small helpers', () => {
  it('badgeText caps at 9+', () => {
    expect(badgeText(3)).toBe('3')
    expect(badgeText(9)).toBe('9')
    expect(badgeText(10)).toBe('9+')
  })
  it('shortId', () => expect(shortId('fb_7xq2abcdef')).toBe('#7xq2ab'))
  it('fieldErrors', () => {
    const base = { titleMax: 5, bodyMax: 10 }
    expect(fieldErrors({ ...base, title: ' ', body: '', composed: '' })).toEqual({
      title: 'titleEmpty',
      body: 'bodyEmpty',
    })
    expect(fieldErrors({ ...base, title: 'abcdef', body: 'x', composed: 'x'.repeat(11) })).toEqual({
      title: 'titleLong',
      body: 'bodyLong',
    })
    expect(fieldErrors({ ...base, title: 'ok', body: 'x', composed: 'x' })).toEqual({ title: null, body: null })
  })
})
