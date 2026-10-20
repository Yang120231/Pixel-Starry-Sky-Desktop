// 订阅账号多开（docs/ui/engine-accounts.md）：账号列表、切换、添加 / 重新登录 / 移除、各账号额度、额度用完自动换账号。
// 先做 Codex。当前账号是全局的：适配器启动 Codex 时按 currentDir() 换 CODEX_HOME，launchKey 带上账号 id，
// 切换后正在跑的这一轮不受影响，下一条消息前换进程接上原对话。
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import {
  DEFAULT_ACCOUNT,
  viaGateway,
  type AccountAutoSwitch,
  type AccountEngine,
  type AccountPatch,
  type EngineAccount,
  type EngineAccountQuota,
  type EngineAccounts,
  type EngineId,
  type EngineLogin,
} from '@pixelsky/protocol'
import type { AccountProbe } from '../adapter'
import { logger } from '../log'
import type { HostContext } from './context'

const log = logger('engine.accounts')

const ENGINES: readonly AccountEngine[] = ['codex']
const ACCOUNT_ID = /^a_[a-f0-9]{12}$/
const LABEL_MAX = 40
/** 各账号额度缓存多久 */
const QUOTA_TTL = 60_000

export const DEFAULT_AUTO: AccountAutoSwitch = { enabled: false, order: 'list', switchBack: true, notice: true }

interface EngineState {
  current: string
  accounts: EngineAccount[]
  auto: AccountAutoSwitch
  /** 自动换账号之前用的那个：额度恢复后换回去（auto.switchBack） */
  switchedFrom: string | null
}

const text = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

function readAuto(raw: unknown): AccountAutoSwitch {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    enabled: o.enabled === true,
    order: o.order === 'most' ? 'most' : 'list',
    switchBack: o.switchBack !== false,
    notice: o.notice !== false,
  }
}

function readAccount(raw: unknown): EngineAccount | null {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const id = typeof o.id === 'string' ? o.id : ''
  if (id !== DEFAULT_ACCOUNT && !ACCOUNT_ID.test(id)) return null
  return {
    id,
    email: text(o.email),
    plan: text(o.plan, 40),
    label: text(o.label, LABEL_MAX),
    addedAt: typeof o.addedAt === 'number' && Number.isFinite(o.addedAt) ? o.addedAt : 0,
    status: o.status === 'ok' || o.status === 'expired' ? o.status : 'unknown',
  }
}

/** 设置文件是用户可改的 JSON：读出来再过一遍，不合法的项丢掉 */
export function readAccountsFile(raw: unknown): Partial<Record<AccountEngine, EngineState>> {
  const out: Partial<Record<AccountEngine, EngineState>> = {}
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  for (const engine of ENGINES) {
    const e = o[engine] && typeof o[engine] === 'object' ? (o[engine] as Record<string, unknown>) : null
    if (!e) continue
    const accounts: EngineAccount[] = []
    for (const a of Array.isArray(e.accounts) ? e.accounts : []) {
      const account = readAccount(a)
      if (account && !accounts.some(x => x.id === account.id)) accounts.push(account)
    }
    const known = (id: unknown): id is string => typeof id === 'string' && accounts.some(a => a.id === id)
    out[engine] = {
      current: known(e.current) ? e.current : DEFAULT_ACCOUNT,
      accounts,
      auto: readAuto(e.auto),
      switchedFrom: known(e.switchedFrom) ? e.switchedFrom : null,
    }
  }
  return out
}

/** 窗口里用得最多的百分比；被拒、读不到算 100 */
const usedOf = (q: EngineAccountQuota | undefined): number | null =>
  !q
    ? null
    : q.blocked
      ? 100
      : q.windows.length
        ? Math.max(...q.windows.map(w => (w.rejected ? 100 : w.usedPercent)))
        : null

export const accountEngine = (engine: EngineId): AccountEngine => {
  if (!(ENGINES as readonly string[]).includes(engine)) throw new Error('这个引擎还不支持多账号')
  return engine as AccountEngine
}

export class HostAccounts {
  private state: Partial<Record<AccountEngine, EngineState>>
  private readonly quotas = new Map<string, EngineAccountQuota>()
  private readonly quotaAt = new Map<AccountEngine, number>()
  private readonly reading = new Map<AccountEngine, Promise<EngineAccountQuota[]>>()
  /** 自动换过账号的队列项：同一条消息只换一次，所有账号都用完时不来回换 */
  private readonly autoSwitched = new Set<string>()

  constructor(private readonly ctx: HostContext) {
    this.state = readAccountsFile(ctx.store.loadAccounts())
  }

  private engineState(engine: AccountEngine): EngineState {
    return (this.state[engine] ??= {
      current: DEFAULT_ACCOUNT,
      accounts: [],
      auto: { ...DEFAULT_AUTO },
      switchedFrom: null,
    })
  }

  private adapter(engine: AccountEngine) {
    const adapter = this.ctx.adapters[engine]
    if (!adapter?.accountProbe || !adapter.accountLogin || !adapter.accountLogout)
      throw new Error('这个引擎还不支持多账号')
    return adapter as typeof adapter & Required<Pick<typeof adapter, 'accountProbe' | 'accountLogin' | 'accountLogout'>>
  }

  /** 账号的目录；原来的账号是 null（用户本来的 CODEX_HOME） */
  dir(engine: AccountEngine, id: string): string | null {
    return id === DEFAULT_ACCOUNT ? null : join(this.ctx.opts.dataDir, 'accounts', engine, id)
  }

  currentId(engine: EngineId): string {
    const s = (this.state as Partial<Record<EngineId, EngineState>>)[engine]
    return s && s.accounts.some(a => a.id === s.current) ? s.current : DEFAULT_ACCOUNT
  }

  /** 适配器启动引擎时用的目录 */
  currentDir(engine: AccountEngine): string | null {
    return this.dir(engine, this.currentId(engine))
  }

  private save(): void {
    try {
      this.ctx.store.saveAccounts({ version: 1, ...this.state })
    } catch (error) {
      log.warn('save accounts failed', { error: (error as Error).message })
    }
  }

  private publish(engine: AccountEngine): void {
    if (!this.ctx.closing) this.ctx.opts.emit({ kind: 'engine_accounts', accounts: this.snapshot(engine) })
  }

  private snapshot(engine: AccountEngine): EngineAccounts {
    const s = this.engineState(engine)
    return { engine, current: this.currentId(engine), accounts: s.accounts.map(a => ({ ...a })), auto: { ...s.auto } }
  }

  /** 换了当前账号：重新检测（引擎卡片上的邮箱、套餐跟着变），广播列表 */
  private changed(engine: AccountEngine, redetect: boolean): void {
    this.save()
    this.publish(engine)
    if (redetect) void this.ctx.m.settings.engines(true).catch(() => undefined)
  }

  /**
   * 列表。原来的账号：在用它时按检测结果更新邮箱和套餐；还没添加过别的账号时，登录着就作为唯一一项列出（不写进文件）
   */
  async list(engine: EngineId): Promise<EngineAccounts> {
    const e = accountEngine(engine)
    const s = this.engineState(e)
    const info = await this.ctx.adapters[e]?.info().catch(() => null)
    if (this.currentId(e) === DEFAULT_ACCOUNT && info) {
      const email = text(info.account?.email),
        plan = text(info.account?.plan, 40)
      const row = s.accounts.find(a => a.id === DEFAULT_ACCOUNT)
      if (row && (row.email !== email || row.plan !== plan) && email) {
        Object.assign(row, { email, plan, status: 'ok' as const })
        this.save()
      }
      if (!s.accounts.length && email)
        return {
          ...this.snapshot(e),
          accounts: [{ id: DEFAULT_ACCOUNT, email, plan, label: null, addedAt: 0, status: 'ok' }],
        }
    }
    return this.snapshot(e)
  }

  /** 添加账号：登录到一个新目录，成功后读出邮箱加进列表，不换掉当前账号 */
  add(engine: EngineId, method: 'browser' | 'device'): EngineLogin {
    const e = accountEngine(engine)
    const adapter = this.adapter(e)
    const id = 'a_' + randomBytes(6).toString('hex')
    const dir = this.dir(e, id)
    return this.ctx.m.login.loginEngine(e, method, {
      target: 'add',
      login: (m, onLine) => adapter.accountLogin(dir, m, onLine),
      verify: () => this.added(e, id),
    })
  }

  /** 重新登录某个账号（登录失效了）：登录到它自己的目录 */
  relogin(engine: EngineId, id: string, method: 'browser' | 'device'): EngineLogin {
    const e = accountEngine(engine)
    const adapter = this.adapter(e)
    const row = this.find(e, id)
    const dir = this.dir(e, row.id)
    return this.ctx.m.login.loginEngine(e, method, {
      target: row.id,
      login: (m, onLine) => adapter.accountLogin(dir, m, onLine),
      verify: async () => {
        const probe = await adapter.accountProbe(dir)
        if (!probe.signedIn) return '登录命令结束了，但还没有登录成功'
        if (row.email && probe.email && row.email.toLowerCase() !== probe.email.toLowerCase())
          return `登录的是 ${probe.email}，不是 ${row.email}。要添加新账号请用「添加账号」`
        this.applyProbe(e, row, probe)
        this.changed(e, this.currentId(e) === row.id)
        return null
      },
    })
  }

  private find(engine: AccountEngine, id: string): EngineAccount {
    const row = this.engineState(engine).accounts.find(a => a.id === id)
    if (!row) throw new Error('没有这个账号')
    return row
  }

  private applyProbe(engine: AccountEngine, row: EngineAccount, probe: AccountProbe): void {
    row.status = probe.signedIn ? 'ok' : 'expired'
    if (probe.email) row.email = probe.email
    if (probe.plan) row.plan = probe.plan
    const q = probe.quota
    this.quotas.set(`${engine}:${row.id}`, {
      id: row.id,
      windows: q?.kind === 'ok' ? q.windows : [],
      blocked: q?.kind === 'ok' ? !!q.blocked : false,
      observedAt: Date.now(),
    })
  }

  /** 添加的账号登录成功：读邮箱；已经在列表里的不重复添加（退出新目录里的登录） */
  private async added(engine: AccountEngine, id: string): Promise<string | null> {
    const adapter = this.adapter(engine)
    const dir = this.dir(engine, id)
    const probe = await adapter.accountProbe(dir)
    if (!probe.signedIn) return '登录命令结束了，但还没有登录成功'
    const s = this.engineState(engine)
    // 第一次添加：原来的账号登录着就先放进列表（排第一）
    if (!s.accounts.length) {
      const original = await adapter.accountProbe(null).catch(() => null)
      if (original?.signedIn) {
        const row: EngineAccount = {
          id: DEFAULT_ACCOUNT,
          email: null,
          plan: null,
          label: null,
          addedAt: 0,
          status: 'ok',
        }
        this.applyProbe(engine, row, original)
        s.accounts.push(row)
      }
    }
    const same = probe.email && s.accounts.find(a => a.email && a.email.toLowerCase() === probe.email!.toLowerCase())
    if (same) {
      void adapter.accountLogout(dir).catch(() => undefined)
      this.changed(engine, false)
      return `${probe.email} 已经在列表里了`
    }
    const row: EngineAccount = { id, email: null, plan: null, label: null, addedAt: Date.now(), status: 'ok' }
    this.applyProbe(engine, row, probe)
    s.accounts.push(row)
    this.changed(engine, false)
    return null
  }

  async switchTo(engine: EngineId, id: string): Promise<EngineAccounts> {
    const e = accountEngine(engine)
    const s = this.engineState(e)
    const row = this.find(e, id)
    if (row.status === 'expired') throw new Error('这个账号的登录已失效，请先重新登录')
    if (this.currentId(e) !== id) {
      s.current = id
      // 手动换过就不再自动换回去
      s.switchedFrom = null
      this.changed(e, true)
    }
    return this.snapshot(e)
  }

  async remove(engine: EngineId, id: string): Promise<EngineAccounts> {
    const e = accountEngine(engine)
    const s = this.engineState(e)
    this.find(e, id)
    if (id === this.currentId(e)) throw new Error('正在用这个账号，先切换到别的账号再移除')
    if (id === DEFAULT_ACCOUNT) throw new Error('原来的账号不能在这里移除，切换到它之后可以在模型通道里取消授权')
    // 只退出登录、移出列表，目录骨架留着：Codex 的线程索引里记着这个目录下的路径
    await this.adapter(e)
      .accountLogout(this.dir(e, id))
      .catch(() => undefined)
    s.accounts = s.accounts.filter(a => a.id !== id)
    if (s.switchedFrom === id) s.switchedFrom = null
    this.quotas.delete(`${e}:${id}`)
    // 只剩原来的账号时清空列表，界面回到单账号
    if (s.accounts.length === 1 && s.accounts[0].id === DEFAULT_ACCOUNT) s.accounts = []
    this.changed(e, false)
    return this.snapshot(e)
  }

  update(engine: EngineId, id: string, patch: AccountPatch): EngineAccounts {
    const e = accountEngine(engine)
    const s = this.engineState(e)
    const row = this.find(e, id)
    if (patch.label !== undefined) {
      if (patch.label !== null && typeof patch.label !== 'string') throw new Error('备注不对')
      row.label = text(patch.label, LABEL_MAX)
    }
    if (patch.move === 'up') {
      const i = s.accounts.indexOf(row)
      if (i > 0) s.accounts.splice(i - 1, 2, row, s.accounts[i - 1])
    }
    this.changed(e, false)
    return this.snapshot(e)
  }

  setAuto(engine: EngineId, patch: Partial<AccountAutoSwitch>): EngineAccounts {
    const e = accountEngine(engine)
    const s = this.engineState(e)
    const next = { ...s.auto }
    for (const key of ['enabled', 'switchBack', 'notice'] as const)
      if (patch[key] !== undefined) {
        if (typeof patch[key] !== 'boolean') throw new Error('自动切换的设置不对')
        next[key] = patch[key]
      }
    if (patch.order !== undefined) {
      if (patch.order !== 'list' && patch.order !== 'most') throw new Error('自动切换的设置不对')
      next.order = patch.order
    }
    s.auto = next
    if (!next.enabled || !next.switchBack) s.switchedFrom = null
    this.changed(e, false)
    return this.snapshot(e)
  }

  /** 各账号的额度和登录状态：一个一个起临时进程读，缓存 60 秒；读完看要不要换回原来的账号 */
  async quota(engine: EngineId, force = false): Promise<EngineAccountQuota[]> {
    const e = accountEngine(engine)
    const s = this.engineState(e)
    const rows = (): EngineAccountQuota[] => s.accounts.flatMap(a => this.quotas.get(`${e}:${a.id}`) ?? [])
    if (!force && Date.now() - (this.quotaAt.get(e) ?? 0) < QUOTA_TTL) return rows()
    const running = this.reading.get(e)
    if (running) return running
    const task = (async () => {
      const adapter = this.adapter(e)
      let statusChanged = false
      for (const row of [...s.accounts]) {
        if (this.ctx.closing) break
        const before = JSON.stringify([row.status, row.email, row.plan])
        try {
          this.applyProbe(e, row, await adapter.accountProbe(this.dir(e, row.id)))
        } catch (error) {
          const prev = this.quotas.get(`${e}:${row.id}`)
          this.quotas.set(`${e}:${row.id}`, {
            id: row.id,
            windows: prev?.windows ?? [],
            blocked: prev?.blocked ?? false,
            observedAt: prev?.observedAt ?? 0,
            error: (error as Error).message,
          })
        }
        if (JSON.stringify([row.status, row.email, row.plan]) !== before) statusChanged = true
      }
      this.quotaAt.set(e, Date.now())
      const back = this.switchBack(e)
      if (statusChanged || back) this.changed(e, back)
      return rows()
    })().finally(() => this.reading.delete(e))
    this.reading.set(e, task)
    return task
  }

  /** 自动换过账号、原来那个额度恢复了：换回去（下一条消息起） */
  private switchBack(engine: AccountEngine): boolean {
    const s = this.engineState(engine)
    const from = s.switchedFrom
    if (!s.auto.enabled || !s.auto.switchBack || !from || from === this.currentId(engine)) return false
    const row = s.accounts.find(a => a.id === from)
    const used = usedOf(this.quotas.get(`${engine}:${from}`))
    if (!row || row.status !== 'ok' || used === null || used >= 100) return false
    s.current = from
    s.switchedFrom = null
    return true
  }

  /** 下一个还有额度的账号：跳过当前的、登录失效的、上次读到已用完的 */
  private pickNext(engine: AccountEngine): EngineAccount | null {
    const s = this.engineState(engine)
    const current = this.currentId(engine)
    const i = s.accounts.findIndex(a => a.id === current)
    const ordered = [...s.accounts.slice(i + 1), ...s.accounts.slice(0, Math.max(0, i))]
    const usable = ordered.filter(a => {
      if (a.id === current || a.status === 'expired') return false
      const used = usedOf(this.quotas.get(`${engine}:${a.id}`))
      return used === null || used < 100
    })
    if (s.auto.order === 'most') {
      // 读到过额度的按已用从少到多，没读到的排在后面
      const rank = (a: EngineAccount): number => usedOf(this.quotas.get(`${engine}:${a.id}`)) ?? 101
      usable.sort((a, b) => rank(a) - rank(b))
    }
    return usable[0] ?? null
  }

  /**
   * 一轮因为额度用完失败（Codex usageLimitExceeded）：开了自动切换、会话走的是自己的订阅时换到下一个账号。
   * 返回换到的账号；没换返回 null。同一条消息只换一次
   */
  autoSwitch(sessionId: string, queueId: string): EngineAccount | null {
    const rt = this.ctx.runtimes.get(sessionId)
    if (!rt) return null
    const record = rt.execution ?? rt.snapshot.record
    if (record.engine !== 'codex' || viaGateway(record)) return null
    const e: AccountEngine = 'codex'
    const s = this.engineState(e)
    if (!s.auto.enabled || s.accounts.length < 2 || this.autoSwitched.has(queueId)) return null
    const from = this.currentId(e)
    // 当前账号记成用完，「剩余最多」和换回去都按它算
    const prev = this.quotas.get(`${e}:${from}`)
    this.quotas.set(`${e}:${from}`, {
      id: from,
      windows: prev?.windows ?? [],
      blocked: true,
      observedAt: Date.now(),
    })
    const next = this.pickNext(e)
    if (!next) return null
    this.autoSwitched.add(queueId)
    if (this.autoSwitched.size > 500) this.autoSwitched.delete(this.autoSwitched.values().next().value!)
    s.switchedFrom ??= from
    s.current = next.id
    log.info('auto switched account', { engine: e, sessionId })
    this.changed(e, true)
    return next
  }

  /** 自动换了账号要不要在对话里提示 */
  noticeOn(engine: AccountEngine): boolean {
    return this.engineState(engine).auto.notice
  }
}
