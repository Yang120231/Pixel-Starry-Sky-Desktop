import { describe, expect, it } from 'vitest'
import { DEFAULT_NOTIFICATION_PREFS } from '../notifications/policy'
import type { FeedbackSummary } from '../../../../shared/types/feedback'
import {
  checkCreate,
  checkReply,
  clipErrorText,
  composeBody,
  errorText,
  freshNotice,
  matchesFilter,
  mergeThreads,
  shouldNotify,
  threadOfNotification,
  windowSince,
} from './logic'

const summary = (id: string, over: Partial<FeedbackSummary> = {}): FeedbackSummary => ({
  id,
  type: 'bug',
  title: `t-${id}`,
  status: 'replied',
  createdAt: 1,
  updatedAt: 2,
  unread: true,
  preview: 'reply text',
  previewAuthor: 'team',
  ...over,
})

describe('composeBody', () => {
  it('appends steps under a heading, only when given', () => {
    expect(composeBody(' body ', '', 'Steps')).toBe('body')
    expect(composeBody('body', ' 1. a\n2. b ', 'Steps')).toBe('body\n\n## Steps\n1. a\n2. b')
  })
})

describe('limits', () => {
  const ok = { title: 'hi', body: 'b', composed: 'b', images: 0 }
  it('accepts a valid form', () => expect(checkCreate(ok)).toBeNull())
  it('reports the first problem', () => {
    expect(checkCreate({ ...ok, title: '  ' })).toEqual({ code: 'titleEmpty' })
    expect(checkCreate({ ...ok, title: 'x'.repeat(101) })).toEqual({ code: 'titleLong', limit: 100 })
    expect(checkCreate({ ...ok, body: ' ' })).toEqual({ code: 'bodyEmpty' })
    expect(checkCreate({ ...ok, composed: 'x'.repeat(10_001) })).toEqual({ code: 'bodyLong', limit: 10_000 })
    expect(checkCreate({ ...ok, images: 4 })).toEqual({ code: 'images', limit: 3 })
  })
  it('counts characters, not UTF-16 units', () => {
    expect(checkCreate({ ...ok, title: '😀'.repeat(100) })).toBeNull()
  })
  it('checks replies', () => {
    expect(checkReply({ body: '', images: 0 })).toEqual({ code: 'bodyEmpty' })
    expect(checkReply({ body: 'x', images: 3 })).toBeNull()
  })
  it('clips the error snippet', () => expect([...clipErrorText('a'.repeat(5000))].length).toBe(4000))
})

describe('windowSince', () => {
  it('maps windows to start times', () => {
    expect(windowSince('30m', 10_000_000, null)).toBe(10_000_000 - 1_800_000)
    expect(windowSince('2h', 10_000_000, null)).toBe(10_000_000 - 7_200_000)
    expect(windowSince('around', 10_000_000, 123)).toBe(123)
    expect(windowSince('around', 10_000_000, null)).toBe(10_000_000 - 7_200_000)
  })
})

describe('list helpers', () => {
  it('filters by status', () => {
    expect(matchesFilter('closed', 'open')).toBe(false)
    expect(matchesFilter('replied', 'open')).toBe(true)
    expect(matchesFilter('closed', 'closed')).toBe(true)
    expect(matchesFilter('open', 'all')).toBe(true)
  })
  it('merges pages without duplicates, first page wins', () => {
    const merged = mergeThreads([summary('a', { title: 'new' })], [summary('a'), summary('b')])
    expect(merged.map(t => t.id)).toEqual(['a', 'b'])
    expect(merged[0].title).toBe('new')
  })
})

describe('notifications', () => {
  it('builds one notice for several fresh replies', () => {
    expect(freshNotice([])).toBeNull()
    const one = freshNotice([summary('fb_1')])!
    expect(one).toMatchObject({ id: 'feedback:fb_1', count: 1 })
    expect(one.body).toBe('t-fb_1\nreply text')
    expect(freshNotice([summary('fb_1'), summary('fb_2')])!.count).toBe(2)
  })
  it('clips long bodies to 300', () => {
    expect(freshNotice([summary('x', { preview: 'a'.repeat(900) })])!.body.length).toBe(300)
  })
  it('respects do-not-disturb and unfocusedOnly', () => {
    const now = new Date(2026, 9, 13, 12, 0).getTime()
    expect(shouldNotify(DEFAULT_NOTIFICATION_PREFS, false, now)).toBe(true)
    expect(shouldNotify(DEFAULT_NOTIFICATION_PREFS, true, now)).toBe(false)
    expect(shouldNotify({ ...DEFAULT_NOTIFICATION_PREFS, unfocusedOnly: false }, true, now)).toBe(true)
    expect(shouldNotify({ ...DEFAULT_NOTIFICATION_PREFS, dndUntil: now + 1000 }, false, now)).toBe(false)
  })
  it('routes notification ids', () => {
    expect(threadOfNotification('feedback:fb_9')).toBe('fb_9')
    expect(threadOfNotification('c:s:1')).toBeNull()
  })
})

describe('errorText', () => {
  it('strips the IPC prefix', () => {
    expect(errorText(new Error("Error invoking remote method 'feedback:create': Error: too often"))).toBe('too often')
    expect(errorText('plain')).toBe('plain')
  })
})
