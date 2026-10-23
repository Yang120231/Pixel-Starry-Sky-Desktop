import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { channelRequest, commentMessage, turnNumbers, turnOfItem } from './turnComments'

const user = (id: string) => ({ kind: 'user', id, text: id }) as unknown as Item
const reply = (id: string) => ({ kind: 'assistant', id, text: id, status: 'completed' }) as unknown as Item
const stats = (id: string) =>
  ({
    kind: 'turn_stats',
    id,
    turnId: id,
    outcome: 'completed',
    usage: { durationMs: 1, models: {} },
  }) as unknown as Item

describe('会话评论（docs/ui/channels-collab-v2.md §7）', () => {
  const items = [user('u1'), reply('a1'), stats('t1'), user('u2'), reply('a2'), stats('t2'), user('u3'), reply('a3')]

  it('每一轮按统计行数；一条消息属于它后面第一个统计行那一轮；还在进行的一轮不能评论', () => {
    expect([...turnNumbers(items)]).toEqual([
      ['t1', 1],
      ['t2', 2],
    ])
    expect(turnOfItem(items, 'u1')).toEqual({ turnKey: 't1', turn: 1 })
    expect(turnOfItem(items, 'a2')).toEqual({ turnKey: 't2', turn: 2 })
    expect(turnOfItem(items, 't2')).toEqual({ turnKey: 't2', turn: 2 })
    expect(turnOfItem(items, 'a3')).toBeNull()
    expect(turnOfItem(items, 'nope')).toBeNull()
  })

  it('交给 AI：关于第 N 轮 + 引用（每行加 >）+ 评论；交给成员：@ 他并写清会话和轮次', () => {
    expect(commentMessage({ turn: 2, quote: '第一行\n第二行', text: '这里改成表格' })).toBe(
      '关于第 2 轮：\n\n> 第一行\n> 第二行\n\n这里改成表格',
    )
    expect(commentMessage({ turn: 1, quote: '', text: '太长了' })).toBe('关于第 1 轮：\n\n太长了')
    expect(channelRequest({ turn: 3, quote: 'x', text: '看看' }, '审查员', '登录页')).toBe(
      '@审查员 请看会话「登录页」第 3 轮的这条评论：\n\n> x\n\n看看',
    )
    expect(channelRequest({ turn: 1, quote: '', text: '看看' }, 'a', '')).toContain('「未命名会话」')
  })
})
