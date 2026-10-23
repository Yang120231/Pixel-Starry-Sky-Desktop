import { describe, expect, it } from 'vitest'
import type { ChannelMessage } from '../types/channels'
import { inThread, threadMessages, threadOnly, threadStats } from './threads'

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
    expect(inThread(list[1], 't')).toBe(false)
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
})
