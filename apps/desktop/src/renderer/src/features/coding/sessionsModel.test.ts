import { describe, expect, it } from 'vitest'
import type { SidebarData } from '@/features/engine/hooks'
import { projectConversations } from './sessionsModel'

const data = {
  projects: [
    {
      id: 'p1',
      name: 'p1',
      sessions: [
        { id: 'a', title: 'A', status: 'idle', time: '1h' },
        { id: 'b', title: 'B', status: 'running' },
        { id: 'x', title: 'X', status: 'idle', archivedAt: 1 },
      ],
    },
    { id: 'p2', name: 'p2', sessions: [{ id: 'c', title: 'C', status: 'idle' }] },
  ],
  chats: [{ id: 'f', title: 'F', status: 'idle' }],
  pinned: [
    { id: 'd', title: 'D', status: 'unread', projectId: 'p1', project: 'p1', pinnedAt: 3 },
    { id: 'e', title: 'E', status: 'idle', projectId: 'p2', project: 'p2', pinnedAt: 2 },
    { id: 'g', title: 'G', status: 'idle', projectId: 'chat', project: '对话', pinnedAt: 1 },
  ],
  recent: [],
} as unknown as SidebarData

describe('projectConversations', () => {
  it('置顶的在前，再按侧栏顺序，不含归档和别的项目', () => {
    expect(projectConversations(data, 'p1').map(s => [s.id, s.pinned])).toEqual([
      ['d', true],
      ['a', false],
      ['b', false],
    ])
  })
  it('保留状态和时间', () => {
    const list = projectConversations(data, 'p1')
    expect(list[0].status).toBe('unread')
    expect(list[1]).toMatchObject({ title: 'A', status: 'idle', time: '1h' })
  })
  it('「对话」：置顶的对话在前，再列侧栏「对话」分组', () => {
    expect(projectConversations(data, 'chat').map(s => [s.id, s.pinned])).toEqual([
      ['g', true],
      ['f', false],
    ])
  })
  it('没有项目 / 项目不存在时为空', () => {
    expect(projectConversations(data, null)).toEqual([])
    expect(projectConversations(data, 'nope')).toEqual([])
  })
})
