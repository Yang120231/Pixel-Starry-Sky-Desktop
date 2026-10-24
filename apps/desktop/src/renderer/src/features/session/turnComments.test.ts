import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import {
  channelRequest,
  commentMessage,
  panelComments,
  turnNumbers,
  turnOfItem,
  withCurrentTurns,
  type TurnComment,
} from './turnComments'

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

  it('旧评论存的是旧规则（按统计行数）算的编号：显示和发出前按 turnKey 重算，对不上的保留存的数字', () => {
    // 第一轮被强制停止、没有统计行：旧规则里 t2 是第 1 轮，新规则是第 2 轮
    const list = [user('u1'), reply('a1'), user('u2'), reply('a2'), stats('t2')]
    const mk = (id: string, turnKey: string, turn: number, at: number, resolved = false): TurnComment => ({
      id,
      turnKey,
      turn,
      quote: '',
      text: id,
      at,
      resolved,
    })
    const old = mk('c1', 't2', 1, 2)
    const gone = mk('c2', 'deleted', 7, 1)
    const [fixed, kept] = withCurrentTurns([old, gone], list)
    expect(fixed.turn).toBe(2)
    expect(kept).toBe(gone)
    expect(old.turn).toBe(1)
    // 交给 AI / 频道时用重算后的编号
    expect(commentMessage(fixed)).toBe('关于第 2 轮：\n\n' + 'c1')
    expect(channelRequest(fixed, '审查员', '登录页')).toContain('第 2 轮')
    // 编号本来就对的原样返回，不产生新对象
    const right = mk('c3', 't2', 2, 3)
    expect(withCurrentTurns([right], list)[0]).toBe(right)
  })

  it('右侧面板的评论：按重算后的轮次排序，只看没解决的；会话没加载时用存的编号', () => {
    const list = [user('u1'), reply('a1'), stats('t1'), user('u2'), reply('a2'), stats('t2')]
    const mk = (id: string, turnKey: string, turn: number, at: number, resolved = false): TurnComment => ({
      id,
      turnKey,
      turn,
      quote: '',
      text: id,
      at,
      resolved,
    })
    // 存的编号是反的（旧规则算错了），重算后 t1 在前
    const comments = [mk('b', 't2', 1, 1), mk('a', 't1', 2, 2), mk('r', 't1', 2, 3, true)]
    expect(panelComments(comments, list, false).map(c => [c.id, c.turn])).toEqual([
      ['a', 1],
      ['r', 1],
      ['b', 2],
    ])
    expect(panelComments(comments, list, true).map(c => c.id)).toEqual(['a', 'b'])
    expect(panelComments(comments, undefined, true).map(c => [c.id, c.turn])).toEqual([
      ['b', 1],
      ['a', 2],
    ])
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
