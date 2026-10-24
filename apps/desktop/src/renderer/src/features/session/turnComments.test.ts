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

  it('没有统计行就结束的一轮（强制停止、进程退出）：不挂到下一轮，也照样占一个编号', () => {
    const list = [user('u1'), reply('a1'), user('u2'), reply('a2'), stats('t2')]
    expect(turnOfItem(list, 'a1')).toBeNull()
    expect(turnOfItem(list, 'u1')).toBeNull()
    expect(turnOfItem(list, 'a2')).toEqual({ turnKey: 't2', turn: 2 })
    expect([...turnNumbers(list)]).toEqual([['t2', 2]])
  })

  it('断线重连的「继续」、中途插入的引导接着原来那一轮：编号不变，前半段也能评论', () => {
    const resumed = { kind: 'user', id: 'u1-reconnect-1', text: '继续', reconnect: 1 } as unknown as Item
    const steer = { kind: 'user', id: 'g1', text: '顺便', mode: 'guidance' } as unknown as Item
    // 断开的那段有自己的统计行（t1a），续做完又一行（t1b）
    const list = [
      user('u1'),
      reply('a1'),
      stats('t1a'),
      resumed,
      steer,
      reply('a2'),
      stats('t1b'),
      user('u2'),
      stats('t2'),
    ]
    expect([...turnNumbers(list)]).toEqual([
      ['t1a', 1],
      ['t1b', 1],
      ['t2', 2],
    ])
    expect(turnOfItem(list, 'a1')).toEqual({ turnKey: 't1a', turn: 1 })
    expect(turnOfItem(list, 'a2')).toEqual({ turnKey: 't1b', turn: 1 })
    expect(turnOfItem(list, 'u2')).toEqual({ turnKey: 't2', turn: 2 })
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
