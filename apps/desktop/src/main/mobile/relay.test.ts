import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RelayLink, type RelayNotice } from './relay'

class FakeSocket {
  readyState = 1
  binaryType = ''
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  close(): void {
    this.closed = true
    this.readyState = 3
  }
  send(): void {}
  text(data: string): void {
    this.onmessage?.({ data })
  }
}

function setup() {
  const sockets: FakeSocket[] = [],
    statuses: string[] = [],
    notices: RelayNotice[] = []
  const link = new RelayLink({
    url: 'wss://relay.example/v1/bridge/ws',
    desktopId: 'desk-1',
    onFrame: () => {},
    onNotice: n => notices.push(n),
    onStatus: s => statuses.push(s),
    token: async () => 'token',
    socket: () => {
      const s = new FakeSocket()
      sockets.push(s)
      return s as unknown as WebSocket
    },
  })
  return { link, sockets, statuses, notices }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('RelayLink heartbeat', () => {
  it('收到过 tick 后 60 秒没有消息：不等 onclose，直接断开重连；tick 不当作通知', async () => {
    const { link, sockets, statuses, notices } = setup()
    link.start()
    await vi.advanceTimersByTimeAsync(0)
    sockets[0].onopen?.()
    sockets[0].text('{"type":"tick"}')
    sockets[0].text('{"type":"phone_joined","phone":"p1"}')
    expect(notices).toEqual([{ type: 'phone_joined', phone: 'p1' }])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets[0].closed).toBe(false)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(sockets[0].closed).toBe(true)
    expect(statuses.at(-1)).toBe('error')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sockets).toHaveLength(2)
    link.stop()
  })

  it('老版本云端不发 tick：不按心跳断开', async () => {
    const { link, sockets } = setup()
    link.start()
    await vi.advanceTimersByTimeAsync(0)
    sockets[0].onopen?.()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(sockets[0].closed).toBe(false)
    link.stop()
  })
})
