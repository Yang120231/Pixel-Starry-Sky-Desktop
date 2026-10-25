import { describe, expect, it, vi } from 'vitest'
import type { FeedbackState, FeedbackSummary } from '../../../../shared/types/feedback'

const thread = (id: string, unread: boolean): FeedbackSummary => ({
  id,
  type: 'bug',
  title: id,
  status: 'replied',
  createdAt: 1,
  updatedAt: 2,
  unread,
  preview: '',
  previewAuthor: 'team',
  teamSeen: false,
  teamSeenAt: null,
  working: false,
  workingAt: null,
  messageCount: 1,
  attachments: { logs: 0, images: 0 },
})

const initial: FeedbackState = {
  status: 'ready',
  email: 'a@x.com',
  unreadCount: 2,
  threads: [thread('a', true), thread('b', true), thread('c', false)],
  nextBefore: null,
  error: null,
  checkedAt: 1,
}

const markAllRead = vi.fn<() => Promise<void>>()
const bridge = {
  state: async () => initial,
  onChange: () => () => {},
  markAllRead,
}
;(globalThis as { window?: unknown }).window = { pixelsky: { feedback: bridge, demo: false } }

const store = await import('./store')

describe('markAllRead', () => {
  it('clears unread locally right away, and restores them with the error when the request fails', async () => {
    const stop = store.onFeedbackChange(() => {})
    await vi.waitFor(() => expect(store.getFeedbackSnapshot().loading).toBe(false))
    expect(store.getFeedbackSnapshot().unreadCount).toBe(2)

    let fail!: (e: Error) => void
    markAllRead.mockReturnValueOnce(new Promise<void>((_, reject) => (fail = reject)))
    const pending = store.markAllRead()
    expect(store.getFeedbackSnapshot().unreadCount).toBe(0)
    expect(store.getFeedbackSnapshot().threads.some(t => t.unread)).toBe(false)

    const error = new Error('boom')
    fail(error)
    expect(await pending).toBe(error)
    expect(store.getFeedbackSnapshot().unreadCount).toBe(2)
    expect(
      store
        .getFeedbackSnapshot()
        .threads.filter(t => t.unread)
        .map(t => t.id),
    ).toEqual(['a', 'b'])

    markAllRead.mockResolvedValueOnce()
    expect(await store.markAllRead()).toBeNull()
    expect(store.getFeedbackSnapshot().unreadCount).toBe(0)
    stop()
  })
})
