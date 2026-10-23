import { describe, expect, it } from 'vitest'
import type { ChannelMessage } from '../types/channels'
import { threadMessages, threadOnly, threadRootOf, threadStats } from './threads'

const msg = (id: string, at: number, patch: Record<string, unknown> = {}): ChannelMessage =>
  ({ kind: 'message', id, channelId: 'c', at, authorId: 'you', text: id, format: 'plain', ...patch }) as ChannelMessage
const card = {
  kind: 'task',
  id: 't',
  channelId: 'c',
  at: 2,
  authorId: 'you',
  assigneeId: 'a',
  title: 'x',
  status: 'done',
}

describe('讨论串（docs/ui/channels-collab-v2.md §3）', () => {
  const list: ChannelMessage[] = [
    msg('src', 1),
    card as ChannelMessage,
    msg('result', 3, { authorId: 'a', taskId: 't', replyToId: 't' }),
    msg('quote', 4, { replyToId: 't' }),
    msg('in', 5, { threadId: 't' }),
    msg('elsewhere', 6, { threadId: 'src' }),
    msg('plain', 7),
  ]

  it('串里有：发在串里的、卡片的结果、引用它的回复；发在别的串里的不算', () => {
    expect(threadMessages(list, 't').map(m => m.id)).toEqual(['result', 'quote', 'in'])
    expect(threadMessages(list, 'src').map(m => m.id)).toEqual(['elsewhere'])
    expect(threadMessages(list, 't').some(m => m.id === 't')).toBe(false)
    expect(threadOnly(list[4])).toBe(true)
    expect(threadOnly(list[2])).toBe(false)
  })

  it('回复数和最新一条；根不在已读进来的消息里时不算', () => {
    const stats = threadStats([...list, msg('orphan', 8, { threadId: 'gone' })])
    expect(stats.get('t')).toMatchObject({ count: 3, last: { id: 'in' } })
    expect(stats.get('src')).toMatchObject({ count: 1 })
    expect(stats.has('gone')).toBe(false)
    expect(stats.has('plain')).toBe(false)
  })

  it('任务结果归到它的任务卡：在结果上开串、引用结果的回复、发在结果串里的都算卡片的串', () => {
    expect(threadRootOf(list, 'result')).toBe('t')
    expect(threadRootOf(list, 'in')).toBe('t')
    expect(threadRootOf(list, 'src')).toBe('src')
    // 任务卡没读进来时就在结果上开
    expect(threadRootOf(list.slice(2), 'result')).toBe('result')
    const more = [...list, msg('onResult', 8, { threadId: 'result' }), msg('quoteResult', 9, { replyToId: 'result' })]
    expect(threadMessages(more, 't').map(m => m.id)).toEqual(['result', 'quote', 'in', 'onResult', 'quoteResult'])
    const stats = threadStats(more)
    expect(stats.get('t')).toMatchObject({ count: 5, last: { id: 'quoteResult' } })
    expect(stats.has('result')).toBe(false)
  })
})
