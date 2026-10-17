import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { reconnectView } from './reconnectView'

const user = (id: string, reconnect?: number): Item => ({
  kind: 'user',
  id,
  text: reconnect ? '继续' : id,
  createdAt: 0,
  ...(reconnect ? { reconnect } : {}),
})
const reply = (id: string): Item => ({ kind: 'assistant', id, text: id, status: 'completed' })
const error = (id: string): Item => ({ kind: 'notice', id, level: 'error', text: '连接中断' })
const ids = (items: Item[]) => items.map(i => i.id)

describe('reconnectView', () => {
  it('没有重连时原样返回', () => {
    const items = [user('u'), reply('r'), error('e')]
    expect(reconnectView(items, false).items).toBe(items)
  })

  it('接着重连了的断线报错不显示；连着几次没接上的只留最后一行小字', () => {
    const items = [user('u'), reply('r1'), error('e1'), user('c1', 1), error('e2'), user('c2', 2), reply('r2')]
    const view = reconnectView(items, false)
    expect(ids(view.items)).toEqual(['u', 'r1', 'c2', 'r2'])
    expect(view.failed.size).toBe(0)
  })

  it('正在等下一次重连：最后一轮的报错和小字先收起来', () => {
    const items = [user('u'), reply('r1'), error('e1'), user('c1', 1), error('e2')]
    expect(ids(reconnectView(items, true).items)).toEqual(['u', 'r1'])
  })

  it('次数用完：最后的报错照常显示，小字不写「已重连」', () => {
    const items = [user('u'), error('e1'), user('c1', 1), error('e2')]
    const view = reconnectView(items, false)
    expect(ids(view.items)).toEqual(['u', 'c1', 'e2'])
    expect([...view.failed]).toEqual(['c1'])
  })
})
