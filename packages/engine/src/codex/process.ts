import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import type { Launcher } from '../adapter'
import { TailBuffer, } from '../jsonl'

export type Message = Record<string, unknown>
export const object = (v: unknown): Message => v && typeof v === 'object' && !Array.isArray(v) ? v as Message : {}
export const string = (v: unknown): string => typeof v === 'string' ? v : ''
export const array = (v: unknown): unknown[] => Array.isArray(v) ? v : []
export const number = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0
export const redact = (text: string): string => text.replace(/(?:sk-[A-Za-z0-9_-]+|Bearer\s+[^\s"']+)/gi, '[redacted]')

export interface RpcHandlers {
  notification(method: string, params: Message): void
  request(id: string | number, method: string, params: Message): void
  exit(code: number | null, tail: string): void
}
export class CodexProcess {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly pending = new Map<number, { resolve: (value: Message) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  private readonly stderr = new TailBuffer()
  private sequence = 0
  private exited = false
  readonly exitPromise: Promise<void>

  constructor(launcher: Launcher, args: string[], cwd: string, env: NodeJS.ProcessEnv, handlers: RpcHandlers) {
    this.child = spawn(launcher.command, [...launcher.args, ...args], { cwd, env, windowsHide: true, stdio: 'pipe' })
    this.child.stdin.on('error', () => {})
    this.child.stderr.on('data', (data: Buffer) => this.stderr.push(redact(data.toString('utf8'))))
    const decoder = new StringDecoder('utf8')
    let buffer = ''
    this.child.stdout.on('data', (data: Buffer) => {
      buffer += decoder.write(data)
      if (buffer.length > 40 * 1024 * 1024) { this.stderr.push('Codex protocol frame exceeds limit'); this.kill(); return }
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        let value: Message
        try { value = object(JSON.parse(line)) } catch { continue }
        if (typeof value.method === 'string') {
          if (typeof value.id === 'string' || typeof value.id === 'number') handlers.request(value.id, value.method, object(value.params))
          else handlers.notification(value.method, object(value.params))
        } else if (typeof value.id === 'number') {
          const request = this.pending.get(value.id)
          if (!request) continue
          clearTimeout(request.timer); this.pending.delete(value.id)
          if (value.error) request.reject(new Error(redact(string(object(value.error).message) || 'Codex RPC error')))
          else request.resolve(object(value.result))
        }
      }
    })
    this.exitPromise = new Promise(resolve => {
      const finish = (code: number | null): void => {
        if (this.exited) return
        this.exited = true
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Codex process exited')) }
        this.pending.clear(); handlers.exit(code, this.stderr.toString()); resolve()
      }
      this.child.once('exit', finish)
      this.child.once('error', error => { this.stderr.push(redact(error.message)); finish(null) })
    })
  }
  get alive(): boolean { return !this.exited }
  notify(method: string, params: unknown = {}): void { this.write({ method, params }) }
  respond(id: string | number, result: unknown): void { this.write({ id, result }) }
  respondError(id: string | number, message: string): void { this.write({ id, error: { code: -32601, message } }) }
  private write(value: unknown): void { if (!this.exited && !this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify(value) + '\n') }
  request(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<Message> {
    if (this.exited) return Promise.reject(new Error('Codex process exited'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex did not respond: ${method}`)) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer }); this.write({ id, method, params })
    })
  }
  async initialize(experimentalApi = false): Promise<Message> {
    const result = await this.request('initialize', { clientInfo: { name: 'pixelsky', title: 'Pixel Starry Sky', version: '0.1.0' }, capabilities: { experimentalApi } })
    this.notify('initialized'); return result
  }
  async close(): Promise<void> {
    if (!this.alive) return
    this.child.stdin.end()
    const timer = setTimeout(() => this.kill(), 2000)
    await this.exitPromise; clearTimeout(timer)
  }
  kill(): void {
    if (!this.alive) return
    if (process.platform === 'win32' && this.child.pid) spawn('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => this.child.kill())
    else this.child.kill()
  }
}
