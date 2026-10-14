import net from 'node:net'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RpcPeer } from './rpc'
import { TunnelEnd, type TunnelPeer } from './tunnel'

const closers: (() => void)[] = []
afterEach(() => {
  closers.splice(0).forEach(close => close())
})

// 桌面端 / 远端各一个 RpcPeer + TunnelEnd，中间用 PassThrough 互连
function setup() {
  const toRemote = new PassThrough(),
    toDesktop = new PassThrough()
  let desktop!: TunnelEnd, remote!: TunnelEnd
  const dPeer = new RpcPeer(toDesktop, toRemote, async (m, a) =>
    (desktop.methods as Record<string, (...args: unknown[]) => unknown>)[m]?.(...a),
  )
  const rPeer = new RpcPeer(toRemote, toDesktop, async (m, a) =>
    (remote.methods as Record<string, (...args: unknown[]) => unknown>)[m]?.(...a),
  )
  desktop = new TunnelEnd(dPeer, 'desktop')
  remote = new TunnelEnd(rPeer, 'remote')
  closers.push(
    () => dPeer.close(),
    () => rPeer.close(),
    () => desktop.close(),
    () => remote.close(),
  )
  return { desktop, remote, dPeer, rPeer }
}

async function echoServer(onConn?: (s: net.Socket) => void) {
  const sockets = new Set<net.Socket>()
  const server = net.createServer(s => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
    s.on('error', () => {})
    if (onConn) onConn(s)
    else s.pipe(s)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  closers.push(() => {
    sockets.forEach(s => s.destroy())
    server.close()
  })
  return { port: (server.address() as net.AddressInfo).port, sockets }
}

function roundtrip(port: number, payload: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const s = net.connect(port, '127.0.0.1', () => s.write(payload))
    closers.push(() => s.destroy())
    s.on('data', c => {
      chunks.push(Buffer.from(c))
      size += c.length
      if (size >= payload.length) {
        s.destroy()
        resolve(Buffer.concat(chunks))
      }
    })
    s.on('error', reject)
  })
}

const closedWithin = (s: net.Socket) =>
  new Promise<boolean>(resolve => {
    if (s.destroyed) return resolve(true)
    s.on('close', () => resolve(true))
    setTimeout(() => resolve(false), 2000)
  })

describe('RPC 隧道', () => {
  it('远端监听、桌面端连本地：往返 1MB 数据', async () => {
    const { desktop } = setup()
    const echo = await echoServer()
    const remotePort = await desktop.listenRemote(echo.port)
    const payload = Buffer.alloc(1024 * 1024, 'abcdefg')
    expect((await roundtrip(remotePort, payload)).equals(payload)).toBe(true)
  })
  it('同一本地端口重复转发复用同一个远端端口', async () => {
    const { desktop } = setup()
    const echo = await echoServer()
    const [a, b] = await Promise.all([desktop.listenRemote(echo.port), desktop.listenRemote(echo.port)])
    expect(a).toBe(b)
    expect(await desktop.listenRemote(echo.port)).toBe(a)
  })
  it('桌面端监听、远端连远端端口：往返 1MB 数据', async () => {
    const { desktop } = setup()
    const echo = await echoServer()
    const localPort = await desktop.listenLocal(echo.port)
    const payload = Buffer.alloc(1024 * 1024, '中文数据')
    expect((await roundtrip(localPort, payload)).equals(payload)).toBe(true)
  })
  it('多个并发连接互不串数据', async () => {
    const { desktop } = setup()
    const echo = await echoServer()
    const viaRemote = await desktop.listenRemote(echo.port)
    const viaLocal = await desktop.listenLocal(echo.port)
    const jobs = Array.from({ length: 12 }, (_, i) => {
      const payload = Buffer.alloc(50_000 + i, String.fromCharCode(65 + i))
      return roundtrip(i % 2 ? viaRemote : viaLocal, payload).then(r => r.equals(payload))
    })
    expect(await Promise.all(jobs)).toEqual(Array(12).fill(true))
  })
  it('应用端关闭后另一端随之关闭', async () => {
    const { desktop } = setup()
    const echo = await echoServer()
    const localPort = await desktop.listenLocal(echo.port)
    const client = net.connect(localPort, '127.0.0.1')
    closers.push(() => client.destroy())
    client.on('error', () => {})
    await new Promise(r => client.once('connect', r))
    client.write('hi')
    await new Promise(r => client.once('data', r))
    echo.sockets.forEach(s => s.destroy())
    expect(await closedWithin(client)).toBe(true)
  })
  it('客户端关闭后服务端那一侧也关闭', async () => {
    const { desktop } = setup()
    const echo = await echoServer()
    const remotePort = await desktop.listenRemote(echo.port)
    const client = net.connect(remotePort, '127.0.0.1')
    client.on('error', () => {})
    await new Promise(r => client.once('connect', r))
    client.write('hi')
    await new Promise(r => client.once('data', r))
    expect(echo.sockets.size).toBe(1)
    client.destroy()
    const deadline = Date.now() + 2000
    while (echo.sockets.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 10))
    expect(echo.sockets.size).toBe(0)
  })
  it('peer 关闭后所有监听都关了', async () => {
    const { desktop, dPeer, rPeer } = setup()
    const echo = await echoServer()
    const remotePort = await desktop.listenRemote(echo.port)
    const localPort = await desktop.listenLocal(echo.port)
    dPeer.close()
    rPeer.close()
    for (const port of [remotePort, localPort]) {
      const refused = await new Promise<boolean>(resolve => {
        const s = net.connect(port, '127.0.0.1')
        s.on('connect', () => (s.destroy(), resolve(false)))
        s.on('error', () => resolve(true))
      })
      expect(refused).toBe(true)
    }
  })
  it('只监听 127.0.0.1', async () => {
    const { desktop } = setup()
    const echo = await echoServer()
    const port = await desktop.listenLocal(echo.port)
    const probe = await new Promise<boolean>(resolve => {
      const s = net.connect(port, '::1')
      s.on('connect', () => (s.destroy(), resolve(true)))
      s.on('error', () => resolve(false))
    })
    expect(probe).toBe(false)
  })
  it('客户端在等连接期间就断开：远端那一头也关掉', async () => {
    const { desktop } = setup()
    const echo = await echoServer()
    const localPort = await desktop.listenLocal(echo.port)
    const client = net.connect(localPort, '127.0.0.1')
    client.on('error', () => {})
    client.once('connect', () => client.destroy())
    await new Promise(r => client.once('close', r))
    const deadline = Date.now() + 2000
    // 远端连上目标后才会登记，先等到出现再等消失
    await new Promise(r => setTimeout(r, 50))
    while (echo.sockets.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 10))
    expect(echo.sockets.size).toBe(0)
  })
  it('目标不读数据时发 tunnel:pause，恢复后发 tunnel:resume 且数据完整', async () => {
    const { desktop, dPeer } = setup()
    const events = vi.spyOn(dPeer, 'event')
    let target!: net.Socket
    let received = 0
    const echo = await echoServer(s => {
      target = s
      s.pause()
      s.on('data', c => (received += c.length))
    })
    const remotePort = await desktop.listenRemote(echo.port)
    const total = 24 * 1024 * 1024
    const client = net.connect(remotePort, '127.0.0.1')
    closers.push(() => client.destroy())
    client.on('error', () => {})
    client.write(Buffer.alloc(total, 'x'))
    const sent = (channel: string) => events.mock.calls.filter(c => c[0] === channel).length
    const deadline = Date.now() + 5000
    while (!sent('tunnel:pause') && Date.now() < deadline) await new Promise(r => setTimeout(r, 10))
    expect(sent('tunnel:pause')).toBeGreaterThan(0)
    const resumed = sent('tunnel:resume')
    target.resume()
    const end = Date.now() + 10_000
    while (received < total && Date.now() < end) await new Promise(r => setTimeout(r, 20))
    expect(received).toBe(total)
    expect(sent('tunnel:resume')).toBeGreaterThan(resumed)
  })
  it('单连接写缓冲超过 8MB：断开并通知对端', async () => {
    const handlers = new Map<string, (d: unknown) => void>()
    const events: [string, unknown][] = []
    const peer: TunnelPeer = {
      call: async () => undefined as never,
      event: (channel, data) => void events.push([channel, data]),
      handle: (channel, cb) => void handlers.set(channel, cb),
    }
    const end = new TunnelEnd(peer, 'remote')
    closers.push(() => end.close())
    const stalled = await echoServer(s => s.pause())
    const id = await end.methods['tunnel:connect'](stalled.port)
    const chunk = Buffer.alloc(1024 * 1024, 'y').toString('base64')
    for (let i = 0; i < 128 && !events.some(e => e[0] === 'tunnel:end'); i++)
      handlers.get('tunnel:data')!({ id, data: chunk })
    expect(events.some(e => e[0] === 'tunnel:end' && (e[1] as { id: string }).id === id)).toBe(true)
  })
  it('RPC 输出积压时暂停读源，降下来再继续', async () => {
    const handlers = new Map<string, (d: unknown) => void>()
    const datas: unknown[] = []
    let backlog = 0
    const peer: TunnelPeer = {
      call: async () => undefined as never,
      event: (channel, data) => void (channel === 'tunnel:data' && datas.push(data)),
      handle: (channel, cb) => void handlers.set(channel, cb),
      get backlog() {
        return backlog
      },
    }
    const end = new TunnelEnd(peer, 'remote')
    closers.push(() => end.close())
    let server!: net.Socket
    const target = await echoServer(s => (server = s))
    const id = await end.methods['tunnel:connect'](target.port)
    handlers.get('tunnel:resume')!({ id })
    const wait = async (cond: () => boolean) => {
      const deadline = Date.now() + 2000
      while (!cond() && Date.now() < deadline) await new Promise(r => setTimeout(r, 10))
    }
    backlog = 20 * 1024 * 1024
    while (!server) await new Promise(r => setTimeout(r, 5))
    server.write('a')
    await wait(() => datas.length === 1)
    server.write('b')
    await new Promise(r => setTimeout(r, 100))
    expect(datas.length).toBe(1)
    backlog = 0
    await wait(() => datas.length === 2)
    expect(datas.length).toBe(2)
  })
})
