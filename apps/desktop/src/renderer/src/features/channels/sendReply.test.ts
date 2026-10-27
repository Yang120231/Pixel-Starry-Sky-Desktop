// 发消息期间点「回复」：发完只清这个频道、这次发的那条引用，不用发送前的拷贝把期间的改动盖掉（审计 2026-10-27 #10）
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/data', () => ({
  isDemo: false,
  channels: [],
  channelMembers: [],
  channelMessages: {},
  channelTeams: [],
}))

let finish: (() => void) | null = null
vi.stubGlobal('window', {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  pixelsky: {
    // 只关心 post；其余方法：订阅类返回取消函数，别的返回空结果
    channels: new Proxy(
      {
        post: (channelId: string) =>
          new Promise(resolve => {
            finish = () => resolve({ message: { kind: 'message', id: 'm-new', channelId, text: 'hi', at: 1 } })
          }),
      } as Record<string, unknown>,
      {
        get: (target, key: string) =>
          target[key] ?? (key.startsWith('on') ? () => () => {} : () => new Promise(() => {})),
      },
    ),
  },
})

const { channelActions, getChannels } = await import('./store')

describe('频道发消息后的引用条', () => {
  it('发送期间别的频道点了回复、这个频道换了引用：都保留', async () => {
    channelActions.setReplyTo('a', 'm1')
    const sending = channelActions.send('a', 'hi')
    channelActions.setReplyTo('b', 'm2')
    finish!()
    await sending
    expect(getChannels().replyTo).toEqual({ a: null, b: 'm2' })

    channelActions.setReplyTo('a', 'm1')
    const again = channelActions.send('a', 'hi')
    channelActions.setReplyTo('a', 'm3')
    finish!()
    await again
    expect(getChannels().replyTo.a).toBe('m3')
  })
})
