// Claude Code 进程：stream-json 双向通信 + stdio 上的 control 协议（docs/engines.md §9）
//
// stdin  ← 用户消息 {"type":"user",...}、control_request（initialize / interrupt / set_model …）、control_response（回答审批）
// stdout → 普通消息（system / stream_event / assistant / user / result）、control_request（can_use_tool 审批）、
//          control_response（回应我们的请求）、control_cancel_request（撤销审批）
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Launcher } from '../adapter'
import { IS_WINDOWS } from '../exec'
import { TailBuffer, readJsonLines } from '../jsonl'
import type { ImageAttachment } from '@pixelsky/protocol'

export interface ControlRequestFromCli {
  requestId: string
  request: Record<string, unknown> & { subtype?: string }
}

export interface ClaudeProcessHandlers {
  onMessage(msg: Record<string, unknown>): void
  onControlRequest(req: ControlRequestFromCli): void
  onControlCancel(requestId: string): void
  onExit(code: number | null, stderrTail: string): void
}

interface Pending {
  resolve(response: Record<string, unknown>): void
  reject(err: Error): void
  timer: NodeJS.Timeout
}

export class ClaudeProcess {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly pending = new Map<string, Pending>()
  private readonly stderr = new TailBuffer()
  private nextId = 0
  private exited = false
  readonly exitPromise: Promise<void>

  constructor(launcher: Launcher, args: string[], cwd: string, env: NodeJS.ProcessEnv, private readonly h: ClaudeProcessHandlers) {
    this.child = spawn(launcher.command, [...launcher.args, ...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child.stdin.on('error', () => {}) // 进程已退出时写入会报 EPIPE，退出事件里统一处理
    this.child.stderr.on('data', (d: Buffer) => this.stderr.push(d.toString('utf8')))
    readJsonLines(this.child.stdout, (msg) => this.dispatch(msg))
    this.exitPromise = new Promise((resolve) => {
      const done = (code: number | null): void => {
        if (this.exited) return
        this.exited = true
        for (const p of this.pending.values()) {
          clearTimeout(p.timer)
          p.reject(new Error('Claude Code 进程已退出'))
        }
        this.pending.clear()
        this.h.onExit(code, this.stderr.toString())
        resolve()
      }
      this.child.on('exit', (code) => done(code))
      this.child.on('error', (err) => {
        this.stderr.push(`\n${err.message}`)
        done(null)
      })
    })
  }

  get alive(): boolean {
    return !this.exited
  }

  get stderrTail(): string {
    return this.stderr.toString()
  }

  private dispatch(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'control_response': {
        const res = (msg.response ?? {}) as Record<string, unknown>
        const id = String(res.request_id ?? '')
        const p = this.pending.get(id)
        if (!p) return
        this.pending.delete(id)
        clearTimeout(p.timer)
        if (res.subtype === 'error') p.reject(new Error(String(res.error ?? '请求失败')))
        else p.resolve((res.response ?? {}) as Record<string, unknown>)
        return
      }
      case 'control_request':
        this.h.onControlRequest({
          requestId: String(msg.request_id ?? ''),
          request: (msg.request ?? {}) as ControlRequestFromCli['request'],
        })
        return
      case 'control_cancel_request':
        this.h.onControlCancel(String(msg.request_id ?? ''))
        return
      default:
        this.h.onMessage(msg)
    }
  }

  private write(obj: unknown): void {
    if (this.exited || this.child.stdin.destroyed) return
    this.child.stdin.write(JSON.stringify(obj) + '\n')
  }

  /** 发 control 请求，等 CLI 回应 */
  request(subtype: string, payload: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<Record<string, unknown>> {
    if (this.exited) return Promise.reject(new Error('Claude Code 进程已退出'))
    const id = `req_${++this.nextId}_${randomUUID().slice(0, 8)}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Claude Code 没有回应 ${subtype}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ type: 'control_request', request_id: id, request: { subtype, ...payload } })
    })
  }

  /** 回答 CLI 发来的 control 请求（审批） */
  respond(requestId: string, response: Record<string, unknown>): void {
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
  }

  respondError(requestId: string, error: string): void {
    this.write({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error } })
  }

  sendUserMessage(text: string, uuid: string, attachments: ImageAttachment[] = []): void {
    const content = attachments.length > 0
      ? [...(text.trim() ? [{ type: 'text', text }] : []), ...attachments.map(image => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.dataBase64 } }))]
      : text
    this.write({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: '',
      uuid,
      // 宿主转发的是用户亲手输入的内容，按 SDK 约定标明来源
      origin: { kind: 'human' },
    })
  }

  /** 关掉 stdin 让进程自己退出；超时还没退就强制结束 */
  async close(timeoutMs = 5_000): Promise<void> {
    if (this.exited) return
    this.child.stdin.end()
    const timer = setTimeout(() => this.kill(), timeoutMs)
    await this.exitPromise
    clearTimeout(timer)
  }

  /** 强制结束；Windows 上连同它启动的子进程（正在跑的命令）一起结束 */
  kill(): void {
    if (this.exited) return
    try {
      if (IS_WINDOWS && this.child.pid) {
        spawn('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () =>
          this.child.kill(),
        )
      } else {
        this.child.kill()
      }
    } catch {
      // 已经退出
    }
  }
}
