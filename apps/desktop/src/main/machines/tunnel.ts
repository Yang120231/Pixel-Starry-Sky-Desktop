import net from 'node:net'
import type { RpcPeer } from './rpc'

export type TunnelPeer = Pick<RpcPeer, 'call' | 'event' | 'handle'> & Partial<Pick<RpcPeer, 'whenClosed' | 'backlog'>>

// 单连接发送缓冲上限：对端写不过来时会发 pause，正常到不了这里；超过就当对端卡死，断开
const BUFFER_LIMIT = 8 * 1024 * 1024
const HOST = '127.0.0.1'
// RPC 输出积压超过高水位就暂停读源 socket，降到低水位再恢复（RpcPeer 在 64MB 时会直接关连接）
const BACKLOG_HIGH = 16 * 1024 * 1024
const BACKLOG_LOW = 4 * 1024 * 1024
const BACKLOG_POLL_MS = 20

/**
 * 经 JSONL RPC 转发 TCP，两端共用（桌面端 'desktop'、远端 'remote'）。只监听 127.0.0.1。
 * 事件：tunnel:open / tunnel:data(base64) / tunnel:end / tunnel:pause / tunnel:resume。
 * 流控：收到数据后 socket.write 返回 false 就给对端发 pause，drain 后发 resume；对端据此暂停 / 恢复读 socket。
 * 新连接一律先暂停读取，等对端登记好 id 并发来 resume 才开始转发，避免数据先于登记到达。
 */
export class TunnelEnd {
  private readonly conns = new Map<string, net.Socket>()
  private readonly servers = new Set<net.Server>()
  private readonly forwards = new Map<number, Promise<number>>()
  private readonly localPorts = new Map<number, number>() // 远端端口 → 本地端口（listenRemote 用）
  private readonly peerPaused = new Set<string>() // 对端要求暂停（它的写缓冲满了）
  private readonly outFull = new Set<string>() // 本端 RPC 输出积压
  private counter = 0
  private closed = false

  /** 注册成对端可调用的 RPC 方法（remote-runtime 并入方法表）。 */
  readonly methods = {
    'tunnel:listen': () => this.serveRemote(),
    'tunnel:connect': (port: number) => this.connectOut(port),
  }

  constructor(
    private readonly peer: TunnelPeer,
    private readonly side: 'desktop' | 'remote',
  ) {
    peer.handle('tunnel:open', d => this.onOpen(d as { id: string; port: number }))
    peer.handle('tunnel:data', d => this.onData(d as { id: string; data: string }))
    peer.handle('tunnel:end', d => this.drop((d as { id: string }).id, false))
    peer.handle('tunnel:pause', d => this.setPeerPaused((d as { id: string }).id, true))
    peer.handle('tunnel:resume', d => this.setPeerPaused((d as { id: string }).id, false))
    peer.whenClosed?.(() => this.close())
  }

  /** 远端监听、桌面端连本机 localPort；返回远端端口。同一 localPort 复用。 */
  listenRemote(localPort: number): Promise<number> {
    let port = this.forwards.get(localPort)
    if (!port) {
      port = this.peer.call<number>('tunnel:listen').then(remote => {
        this.localPorts.set(remote, localPort)
        return remote
      })
      this.forwards.set(localPort, port)
      port.catch(() => this.forwards.delete(localPort))
    }
    return port
  }

  /** 桌面端监听、每个连接让远端连它自己的 remotePort；返回本机端口。 */
  async listenLocal(remotePort: number): Promise<number> {
    const server = net.createServer(socket => {
      socket.pause()
      socket.on('error', () => {})
      this.peer.call<string>('tunnel:connect', [remotePort]).then(
        id => {
          if (this.closed) return socket.destroy()
          // 等连接的间隙客户端已经断了：close 事件错过了，要让远端那头也关掉
          if (socket.destroyed) return this.safeEvent('tunnel:end', { id })
          this.attach(id, socket)
        },
        () => socket.destroy(),
      )
    })
    return this.listen(server)
  }

  close(): void {
    this.closed = true
    for (const server of this.servers) server.close()
    this.servers.clear()
    for (const socket of this.conns.values()) socket.destroy()
    this.conns.clear()
    this.forwards.clear()
    this.localPorts.clear()
    this.peerPaused.clear()
    this.outFull.clear()
  }

  private listen(server: net.Server): Promise<number> {
    if (this.closed) return Promise.reject(new Error('TUNNEL_CLOSED'))
    this.servers.add(server)
    server.on('close', () => this.servers.delete(server))
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, HOST, () => resolve((server.address() as net.AddressInfo).port))
    })
  }

  private nextId(): string {
    return this.side[0] + ++this.counter
  }

  private serveRemote(): Promise<number> {
    const server = net.createServer(socket => {
      socket.pause()
      socket.on('error', () => {})
      const id = this.nextId()
      const port = (server.address() as net.AddressInfo).port
      this.attach(id, socket, false)
      this.safeEvent('tunnel:open', { id, port })
    })
    return this.listen(server)
  }

  private connectOut(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: HOST, port })
      socket.pause()
      socket.once('error', reject)
      socket.once('connect', () => {
        socket.off('error', reject)
        if (this.closed) {
          socket.destroy()
          return reject(new Error('TUNNEL_CLOSED'))
        }
        const id = this.nextId()
        this.attach(id, socket, false)
        resolve(id)
      })
    })
  }

  private onOpen({ id, port }: { id: string; port: number }): void {
    const local = this.localPorts.get(port)
    if (local === undefined || this.closed) return this.safeEvent('tunnel:end', { id })
    const socket = net.connect({ host: HOST, port: local })
    socket.pause()
    this.attach(id, socket, false)
    socket.once('connect', () => this.start(id))
  }

  /** 登记连接并接上双向转发；start 为 true 时马上开始读取并通知对端也开始。 */
  private attach(id: string, socket: net.Socket, start = true): void {
    this.conns.set(id, socket)
    socket.on('data', chunk => {
      this.safeEvent('tunnel:data', { id, data: chunk.toString('base64') })
      if ((this.peer.backlog ?? 0) > BACKLOG_HIGH) this.holdForBacklog(id, socket)
    })
    socket.on('drain', () => this.safeEvent('tunnel:resume', { id }))
    socket.on('error', () => this.drop(id, true))
    socket.on('close', () => this.drop(id, true))
    if (start) this.start(id)
  }

  private start(id: string): void {
    this.setPeerPaused(id, false)
    this.safeEvent('tunnel:resume', { id })
  }

  // 读取只在「对端没喊停」且「本端输出没积压」时进行
  private setPeerPaused(id: string, paused: boolean): void {
    if (paused) this.peerPaused.add(id)
    else this.peerPaused.delete(id)
    this.applyFlow(id)
  }

  private applyFlow(id: string): void {
    const socket = this.conns.get(id)
    if (!socket) return
    if (this.peerPaused.has(id) || this.outFull.has(id)) socket.pause()
    else socket.resume()
  }

  private holdForBacklog(id: string, socket: net.Socket): void {
    if (this.outFull.has(id)) return
    this.outFull.add(id)
    socket.pause()
    const timer = setInterval(() => {
      if (this.conns.get(id) === socket && (this.peer.backlog ?? 0) > BACKLOG_LOW) return
      clearInterval(timer)
      this.outFull.delete(id)
      this.applyFlow(id)
    }, BACKLOG_POLL_MS)
    timer.unref()
  }

  private onData({ id, data }: { id: string; data: string }): void {
    const socket = this.conns.get(id)
    if (!socket) return
    if (socket.writableLength > BUFFER_LIMIT) return this.drop(id, true)
    if (!socket.write(Buffer.from(data, 'base64'))) this.safeEvent('tunnel:pause', { id })
  }

  private drop(id: string, notify: boolean): void {
    const socket = this.conns.get(id)
    if (!socket) return
    this.conns.delete(id)
    this.peerPaused.delete(id)
    this.outFull.delete(id)
    socket.destroy()
    if (notify) this.safeEvent('tunnel:end', { id })
  }

  // peer 已关时 event 会抛，隧道清理不该因此中断
  private safeEvent(channel: string, data: unknown): void {
    try {
      this.peer.event(channel, data)
    } catch {
      /* 连接已断，close() 会收尾 */
    }
  }
}
