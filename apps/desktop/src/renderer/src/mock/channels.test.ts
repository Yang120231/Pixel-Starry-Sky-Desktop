import { describe, expect, it } from 'vitest'
import { demo } from './demo'
import { empty } from '@/data/empty'
import { unreadTotal } from '../channels/model'

describe('协作频道演示数据', () => {
  const ids = new Set(demo.channelMembers.map(m => m.id))
  const messages = Object.values(demo.channelMessages).flat()

  it('id 不重复，每个频道都有消息列表、包含「你」', () => {
    expect(ids.size).toBe(demo.channelMembers.length)
    expect(new Set(messages.map(m => m.id)).size).toBe(messages.length)
    const self = demo.channelMembers.filter(m => m.kind === 'human' && m.you)
    expect(self).toHaveLength(1)
    for (const c of demo.channels) {
      expect(demo.channelMessages[c.id], c.id).toBeDefined()
      expect(c.memberIds, c.id).toContain(self[0].id)
      for (const id of c.memberIds) expect(ids.has(id), `${c.id} ${id}`).toBe(true)
    }
  })
  it('作者、指派对象、引用都能找到，消息按时间排列', () => {
    for (const [channelId, list] of Object.entries(demo.channelMessages)) {
      const own = new Set(list.map(m => m.id))
      list.forEach((m, i) => {
        expect(m.channelId).toBe(channelId)
        if (i > 0) expect(m.at, m.id).toBeGreaterThanOrEqual(list[i - 1].at)
        if (m.kind === 'event') expect(ids.has(m.actorId), m.id).toBe(true)
        else expect(ids.has(m.authorId), m.id).toBe(true)
        if (m.kind === 'task') expect(ids.has(m.assigneeId), m.id).toBe(true)
        if (m.kind === 'message' && m.replyToId) expect(own.has(m.replyToId), m.id).toBe(true)
        if (m.kind === 'message') for (const id of m.mentions ?? []) expect(ids.has(id), m.id).toBe(true)
      })
    }
  })
  it('「打开会话」只指向演示项目里存在的会话', () => {
    const sessions = new Set(demo.projects.flatMap(p => p.sessions.map(s => s.id)))
    for (const m of messages) if (m.kind === 'task' && m.sessionId) expect(sessions.has(m.sessionId), m.id).toBe(true)
    for (const m of demo.channelMembers)
      if (m.kind === 'agent' && m.sessionId) expect(sessions.has(m.sessionId), m.id).toBe(true)
  })
  it('未读合计 3（导航角标），空界面没有频道', () => {
    expect(unreadTotal(demo.channels)).toBe(3)
    expect(empty.channels).toEqual([])
    expect(empty.channelMembers).toEqual([])
    expect(empty.channelMessages).toEqual({})
  })
})
