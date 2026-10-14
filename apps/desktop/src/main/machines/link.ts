import type { RpcPeer } from './rpc'

export interface RemoteHello {
  protocol: number
  platform: string
  arch: string
  hostname: string
  home: string
  node: string
  shell: string
}
/** 远端交互 shell 的一条通道；SSH 和 WSL 各自实现，终端只认这个接口。 */
export interface ShellChannel {
  write(data: string): void
  resize(cols: number, rows: number): void
  pause(): void
  resume(): void
  /** 先 TERM 再关 */
  kill(): void
  onData(cb: (chunk: Buffer) => void): void
  onClose(cb: (code: number | undefined) => void): void
  onError(cb: (e: Error) => void): void
}
/** 到另一台机器（SSH 或 WSL）的连接。 */
export interface RemoteLink {
  peer: RpcPeer | null
  hello: RemoteHello | null
  onClose: (message: string) => void
  openShell(cwd: string, shell: string, size: { cols: number; rows: number }): Promise<ShellChannel>
  forwardGateway(localPort: number): Promise<number>
  forwardPort(remotePort: number): Promise<number>
  close(): void
}
