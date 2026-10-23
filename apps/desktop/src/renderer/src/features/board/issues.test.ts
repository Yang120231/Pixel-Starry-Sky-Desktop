import { describe, expect, it } from 'vitest'
import type { Channel, ChannelMember } from '@/data/types'
import type { ManualTask } from '../../../../shared/types/project-tools'
import {
  assigneeChoices,
  canDispatch,
  matchRule,
  parseAcceptance,
  rejectRequest,
  sameAcceptance,
  type AssignRule,
} from './issues'

const channel = (id: string, memberIds: string[], patch: Partial<Channel> = {}) =>
  ({ id, name: id, scope: 'local', memberIds, unread: 0, createdAt: 0, topic: null, ...patch }) as Channel
const members = [
  { id: 'you', kind: 'human', name: '林夏' },
  { id: 'fe', kind: 'agent', name: '前端' },
  { id: 'qa', kind: 'agent', name: '审查员' },
] as ChannelMember[]
const task = (patch: Partial<ManualTask> = {}) =>
  ({ id: 't', projectId: 'p', title: '登录页', note: '', status: 'pending', tags: [], ...patch }) as ManualTask

describe('事项（docs/ui/channels-collab-v2.md §9）', () => {
  const channels = [
    channel('other', ['you', 'qa']),
    channel('web', ['you', 'fe', 'qa'], { projectId: 'p' }),
    channel('old', ['fe'], { archivedAt: 1 }),
    channel('team', ['fe'], { scope: 'team' }),
  ]

  it('负责人：本机没归档频道里的 AI 成员，这个项目的频道排前面', () => {
    expect(assigneeChoices(channels, members, 'p').map(c => c.key)).toEqual(['web|fe', 'web|qa', 'other|qa'])
    expect(assigneeChoices(channels, members, 'p')[0].assignee).toEqual({
      channelId: 'web',
      memberId: 'fe',
      name: '前端',
    })
  })

  it('分配规则：第一条命中的；标签、关键词不分大小写；成员没了的规则跳过', () => {
    const choices = assigneeChoices(channels, members, null)
    const rule = (kind: AssignRule['kind'], value: string, memberId: string, channelId = 'web'): AssignRule => ({
      id: value,
      kind,
      value,
      assignee: { channelId, memberId, name: memberId },
    })
    const rules = [
      rule('tag', 'UI', 'gone'),
      rule('tag', 'ui', 'fe'),
      rule('keyword', '测试', 'qa'),
      rule('project', 'q', 'qa'),
    ]
    expect(matchRule(rules, task({ tags: ['Ui'] }), choices)?.memberId).toBe('fe')
    expect(matchRule(rules, task({ title: '补测试' }), choices)?.memberId).toBe('qa')
    expect(matchRule(rules, task({ projectId: 'q' }), choices)?.name).toBe('审查员')
    expect(matchRule(rules, task(), choices)).toBeNull()
  })

  it('验收标准一行一条，去掉序号和空行，原来勾过的保持；派活和打回', () => {
    const prior = [{ text: '能登录', done: true }]
    const items = parseAcceptance('1. 能登录\n\n- 有错误提示\n', prior)
    expect(items).toEqual([
      { text: '能登录', done: true },
      { text: '有错误提示', done: false },
    ])
    expect(
      sameAcceptance(
        items,
        items.map(x => ({ ...x })),
      ),
    ).toBe(true)
    expect(sameAcceptance(items, prior)).toBe(false)

    const assignee = { channelId: 'web', memberId: 'fe', name: '前端' }
    expect(canDispatch(task())).toBe(false)
    expect(canDispatch(task({ assignee }))).toBe(true)
    const link = { channelId: 'web', taskId: 'k', state: 'running' as const, round: 1, at: 1 }
    expect(canDispatch(task({ assignee, link }))).toBe(false)
    expect(canDispatch(task({ assignee, link: { ...link, state: 'failed' } }))).toBe(true)
    expect(canDispatch(task({ assignee, status: 'review' }))).toBe(false)

    const t = { text: (m: string, r: string) => `@${m} 没通过：${r}`, unmet: '没达到：' }
    expect(rejectRequest({ acceptance: items }, '前端', ' 颜色不对 ', t)).toBe(
      '@前端 没通过：颜色不对\n\n没达到：\n1. 有错误提示',
    )
    expect(rejectRequest({ acceptance: [] }, '前端', '重做', t)).toBe('@前端 没通过：重做')
  })
})
