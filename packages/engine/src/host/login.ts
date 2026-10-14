// 引擎授权登录（docs/ui/model-channels.md §3）：起适配器的登录命令，把进度推成 engine_login，
// 命令成功退出后重新检测引擎（检测会广播引擎列表）。和 settings 里的安装 / 更新一样，同一个引擎同时只跑一个
import type { EngineId, EngineLogin, EngineUpdateResult } from '@pixelsky/protocol'
import type { LoginProcess } from '../adapter'
import { parseClaudeLogin } from '../claude/login'
import { parseCodexLogin } from '../codex/login'
import type { HostContext } from './context'

/** 登录命令最多等这么久（用户去浏览器里授权的时间） */
export const LOGIN_TIMEOUT_MS = 10 * 60_000

interface Running {
  state: EngineLogin
  proc: LoginProcess | null
  sentAt: number
  timer: NodeJS.Timeout | null
  /** 已经收尾（取消、超时、结束）：之后的回调都不再改状态 */
  finished: boolean
}

/** 一行输出里的授权信息；Pixel 没有登录命令 */
function parseLine(engine: EngineId, line: string): { url?: string; userCode?: string; awaitingCode?: boolean } {
  if (engine === 'claude') return parseClaudeLogin(line)
  if (engine === 'codex') return parseCodexLogin(line)
  return {}
}

export class HostLogin {
  private readonly running = new Map<EngineId, Running>()

  constructor(private readonly ctx: HostContext) {}

  loginEngine(engine: EngineId, method: 'browser' | 'device' = 'browser'): EngineLogin {
    const busy = this.running.get(engine)
    if (busy) return busy.state
    const adapter = this.ctx.adapters[engine]
    if (!adapter?.login) throw new Error('这个引擎不支持在应用里登录')
    const run: Running = {
      state: {
        engine,
        method,
        phase: 'starting',
        startedAt: Date.now(),
        url: null,
        userCode: null,
        awaitingCode: false,
        line: null,
        error: null,
      },
      proc: null,
      sentAt: 0,
      timer: null,
      finished: false,
    }
    this.running.set(engine, run)
    this.emit(run, run.state, true)
    const first = run.state
    void this.start(run, adapter.login.bind(adapter))
    return first
  }

  loginInput(engine: EngineId, text: string): void {
    const run = this.running.get(engine)
    if (!run?.proc || run.finished) throw new Error('没有正在进行的登录')
    run.proc.write(text.trim() + '\n')
    this.emit(run, { ...run.state, awaitingCode: false }, true)
  }

  cancelLogin(engine: EngineId): void {
    const run = this.running.get(engine)
    if (!run || run.finished) return
    this.finish(run, { phase: 'cancelled' })
    run.proc?.kill()
  }

  async logoutEngine(engine: EngineId): Promise<EngineUpdateResult> {
    const adapter = this.ctx.adapters[engine]
    if (!adapter?.logout) throw new Error('这个引擎不支持在应用里取消授权')
    this.cancelLogin(engine)
    const result = await adapter.logout()
    const list = await this.ctx.m.settings.engines(true)
    return { ...result, version: list.find(e => e.id === engine)?.version ?? null }
  }

  /** 退出应用：结束所有还在跑的登录命令 */
  closeAll(): void {
    for (const run of this.running.values()) {
      run.finished = true
      if (run.timer) clearTimeout(run.timer)
      run.proc?.kill()
    }
    this.running.clear()
  }

  private async start(
    run: Running,
    login: (method: 'browser' | 'device', onLine: (line: string) => void) => Promise<LoginProcess>,
  ): Promise<void> {
    const { engine, method } = run.state
    let proc: LoginProcess
    try {
      proc = await login(method, line => this.onLine(run, line))
    } catch (err) {
      this.finish(run, { phase: 'failed', error: (err as Error).message })
      return
    }
    if (run.finished) {
      proc.kill()
      return
    }
    run.proc = proc
    run.timer = setTimeout(() => {
      this.finish(run, { phase: 'failed', error: '超时：10 分钟内没有完成登录' })
      proc.kill()
    }, this.ctx.opts.loginTimeoutMs ?? LOGIN_TIMEOUT_MS)
    if (run.state.phase === 'starting') this.emit(run, { ...run.state, phase: 'waiting' }, true)
    const result = await proc.done
    if (run.finished) return
    if (!result.ok) {
      const error = run.state.line ?? result.error ?? '登录没有成功'
      this.finish(run, { phase: 'failed', error })
      return
    }
    this.emit(run, { ...run.state, phase: 'verify' }, true)
    try {
      const info = (await this.ctx.m.settings.engines(true)).find(e => e.id === engine)
      if (run.finished) return
      if (info?.status === 'ready') this.finish(run, { phase: 'done' })
      else this.finish(run, { phase: 'failed', error: info?.message ?? '登录命令结束了，但还没有登录成功' })
    } catch (err) {
      this.finish(run, { phase: 'failed', error: (err as Error).message })
    }
  }

  private onLine(run: Running, line: string): void {
    if (run.finished) return
    const found = parseLine(run.state.engine, line)
    const next: EngineLogin = {
      ...run.state,
      line,
      url: found.url ?? run.state.url,
      userCode: found.userCode ?? run.state.userCode,
      awaitingCode: found.awaitingCode ? true : run.state.awaitingCode,
      phase: run.state.phase === 'starting' && found.url ? 'waiting' : run.state.phase,
    }
    // 只有输出行变了就限流，网址、设备码、等授权码、阶段变了马上推
    const important =
      next.url !== run.state.url ||
      next.userCode !== run.state.userCode ||
      next.awaitingCode !== run.state.awaitingCode ||
      next.phase !== run.state.phase
    this.emit(run, next, important)
  }

  /** 收尾：停掉超时计时，推最后一个状态，让出这个引擎 */
  private finish(run: Running, patch: Partial<EngineLogin>): void {
    if (run.finished) return
    run.finished = true
    if (run.timer) clearTimeout(run.timer)
    this.emit(run, { ...run.state, awaitingCode: false, ...patch }, true)
    if (this.running.get(run.state.engine) === run) this.running.delete(run.state.engine)
  }

  private emit(run: Running, next: EngineLogin, force = false): void {
    const changed = next.phase !== run.state.phase
    run.state = next
    if (!force && !changed && Date.now() - run.sentAt < 250) return
    run.sentAt = Date.now()
    if (!this.ctx.closing) this.ctx.opts.emit({ kind: 'engine_login', login: next })
  }
}
