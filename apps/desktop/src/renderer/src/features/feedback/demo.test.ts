import { describe, expect, it } from 'vitest'
import type { FeedbackChange } from '../../../../shared/types/feedback'
import { createDemoFeedback } from './demo'

const input = { diagnostics: true, logs: null, images: [], error: null }

describe('demo feedback', () => {
  it('starts with four threads, one unread reply', async () => {
    const api = createDemoFeedback()
    const state = await api.state()
    expect(state.status).toBe('ready')
    expect(state.threads).toHaveLength(4)
    expect(state.unreadCount).toBe(1)
    expect(state.threads.map(t => t.status).sort()).toEqual(['closed', 'open', 'open', 'replied'])
  })

  it('opening the unread thread clears the red dot and notifies listeners', async () => {
    const api = createDemoFeedback()
    const changes: FeedbackChange[] = []
    api.onChange(c => changes.push(c))
    await api.get('fb_demo0000000001')
    expect(changes.at(-1)?.state.unreadCount).toBe(0)
    expect(changes.at(-1)?.fresh).toEqual([])
  })

  it('create, reply, close and reopen only touch local state', async () => {
    const api = createDemoFeedback()
    const created = await api.create({ ...input, type: 'bug', title: 'T', body: 'B' })
    expect(created.thread.status).toBe('open')
    expect((await api.state()).threads[0].id).toBe(created.thread.id)
    const closed = await api.close(created.thread.id)
    expect(closed.thread.status).toBe('closed')
    expect(closed.messages.at(-1)?.kind).toBe('closed')
    const reopened = await api.reply(created.thread.id, { ...input, body: 'more' })
    expect(reopened.thread.status).toBe('open')
    expect(reopened.messages.map(m => m.kind)).toEqual(['message', 'closed', 'reopened', 'message'])
  })

  it('keeps submitted logs and images as fetchable attachments', async () => {
    const api = createDemoFeedback()
    const d = await api.create({
      ...input,
      type: 'other',
      title: 'T',
      body: 'B',
      logs: 'line',
      images: [{ name: 'a.png', mediaType: 'image/png', data: 'AAAA' }],
    })
    const metas = d.messages[0].attachments
    expect(metas.map(a => a.kind)).toEqual(['log', 'image'])
    expect(await api.attachment(d.thread.id, metas[0].id)).toEqual({ kind: 'log', text: 'line' })
  })

  it('derives message and attachment counts and the v2 status fields', async () => {
    const api = createDemoFeedback()
    const [first] = (await api.state()).threads.filter(t => t.id === 'fb_demo0000000001')
    expect(first).toMatchObject({ messageCount: 2, attachments: { logs: 1, images: 0 }, working: true, teamSeen: true })
    const d = await api.create({
      ...input,
      type: 'other',
      title: 'T',
      body: 'B',
      images: [{ name: 'a.png', mediaType: 'image/png', data: 'AAAA' }],
    })
    expect(d.thread).toMatchObject({
      messageCount: 1,
      attachments: { logs: 0, images: 1 },
      working: false,
      teamSeen: false,
    })
  })

  it('previews fixed redacted text', async () => {
    const api = createDemoFeedback()
    const p = await api.preview({ logs: { since: 1 } })
    expect(p.logs?.lines).toBeGreaterThan(0)
    expect((await api.preview({})).logs).toBeNull()
  })
})
