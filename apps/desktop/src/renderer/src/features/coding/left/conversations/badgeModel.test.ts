import { describe, expect, it } from 'vitest'
import { conversationsBadge } from './badgeModel'

describe('conversationsBadge', () => {
  it('没有项目时没有小点', () => {
    expect(conversationsBadge([{ id: 'a', status: 'unread' }], [], null)).toBe(false)
  })
  it('有未读会话就有小点', () => {
    expect(conversationsBadge([{ id: 'a', status: 'unread' }], [], 'p')).toBe(true)
  })
  it('全是空闲或运行中且没有等待类卡片时没有小点', () => {
    const entries = [
      { id: 'a', status: 'idle' as const },
      { id: 'b', status: 'running' as const },
    ]
    expect(conversationsBadge(entries, [{ id: 'b', projectId: 'p', lane: 'running' }], 'p')).toBe(false)
  })
  it('等待类卡片算小点，别的项目不算', () => {
    const entries = [{ id: 'a', status: 'idle' as const }]
    expect(conversationsBadge(entries, [{ id: 'a', projectId: 'p', lane: 'waiting' }], 'p')).toBe(true)
    expect(conversationsBadge(entries, [{ id: 'z', projectId: 'q', lane: 'failed' }], 'p')).toBe(false)
  })
  it('会话在运行中时等待类卡片不算', () => {
    const entries = [{ id: 'a', status: 'running' as const }]
    expect(conversationsBadge(entries, [{ id: 'a', projectId: 'p', lane: 'waiting' }], 'p')).toBe(false)
  })
})
