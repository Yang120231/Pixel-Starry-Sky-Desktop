// 刷新登录的排队（docs/ui/claude-login-recovery.md §1 第 2 条）：访问凭据快过期时，后台的临时进程（模型目录握手、读额度、
// 账号探测）先等一个「预热」进程把登录刷新完再起。Claude Code 自己有跨进程刷新锁，同时刷新不怕；怕的是刷新到一半被我们
// 强制结束（服务器已经换了新凭据、新的没写回文件）。对话进程不走这里，从不等。
// 读不到到期时间（macOS 钥匙串）时，打开软件和待机 30 分钟以上唤醒后各排一次（arm）
import { resolve } from 'node:path'
import type { ClaudeLoginTimes } from './credentials'

/** 访问凭据离到期不到这么久就先刷新（和 Claude Code 自己提前刷新的余量一致） */
export const LOGIN_FRESH_MARGIN_MS = 5 * 60_000
/** 别的进程最多等预热这么久，超过照常起（网络还没好时不一直卡着） */
export const LOGIN_GATE_WAIT_MS = 15_000
/** 同一个目录预热过之后这么久内不再预热（刷新失败、凭据被清空时不反复起进程） */
export const LOGIN_WARMUP_COOLDOWN_MS = 60_000
/** 待机这么久以上唤醒才重新排（访问凭据有效期是几个小时，短暂合盖不会过期） */
export const RESUME_GATE_MIN_MS = 30 * 60_000

export type LoginGateResult =
  /** 不用等 */
  | 'skip'
  /** 自己起了预热、等它做完 */
  | 'warmed'
  /** 等了别人的预热 */
  | 'waited'
  /** 等到上限还没做完，照常起 */
  | 'timeout'

const key = (dir: string): string => {
  const p = resolve(dir)
  return process.platform === 'win32' ? p.toLowerCase() : p
}

export class LoginGate {
  /** 读不到到期时间时：最近一次 arm 的时间（0 = 没 arm 过） */
  private armedAt = 0
  /** 各目录最近一次预热结束的时间 */
  private readonly warmed = new Map<string, number>()
  private readonly running = new Map<string, Promise<void>>()

  constructor(
    private readonly times: (dir: string) => ClaudeLoginTimes | null,
    private readonly now: () => number = Date.now,
    private readonly waitMs = LOGIN_GATE_WAIT_MS,
  ) {}

  /** 打开软件、待机够久后唤醒：读不到到期时间的目录下一次先预热 */
  arm(): void {
    this.armedAt = this.now()
  }

  /** 这个目录现在要不要先预热 */
  needs(dir: string): boolean {
    const last = this.warmed.get(key(dir)) ?? 0
    if (last && this.now() - last < LOGIN_WARMUP_COOLDOWN_MS) return false
    const t = this.times(dir)
    if (t) return t.signedIn && t.expiresAt !== null && t.expiresAt - this.now() < LOGIN_FRESH_MARGIN_MS
    return this.armedAt > 0 && last < this.armedAt
  }

  /** 起后台临时进程之前调：要预热时只有第一个调用的人起预热（warm），其他人等它，最多等 waitMs */
  async before(dir: string, warm: () => Promise<void>): Promise<LoginGateResult> {
    const k = key(dir)
    let task = this.running.get(k)
    let mine = false
    if (!task) {
      if (!this.needs(dir)) return 'skip'
      mine = true
      task = warm()
        .catch(() => undefined)
        .finally(() => {
          this.running.delete(k)
          this.warmed.set(k, this.now())
        })
      this.running.set(k, task)
    }
    let timer: NodeJS.Timeout | undefined
    const done = await Promise.race([
      task.then(() => true),
      new Promise<boolean>(r => {
        timer = setTimeout(() => r(false), this.waitMs)
        timer.unref?.()
      }),
    ])
    clearTimeout(timer)
    if (!done) return 'timeout'
    return mine ? 'warmed' : 'waited'
  }
}
