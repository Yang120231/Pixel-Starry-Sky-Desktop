// 引擎设置：默认值、本机配置、引擎级启动选项、重试次数（docs/ui/engine-settings-redesign.md）
// 设置对象每次修改都整体替换；适配器的回调每次都读 this.file，拿到的总是最新值。
import {
  AUTO_COMPACT_PCTS,
  codedError,
  PROVIDER_ENV,
  EFFORTS,
  PERMISSION_MODES,
  type EngineCatalog,
  type EngineConfig,
  type EngineConfigPatch,
  type EngineDefaults,
  type EngineId,
  type EngineInfo,
  type EngineJob,
  type EngineLocalConfig,
  type EngineUpdateResult,
  type SessionDefaults,
} from '@pixelsky/protocol'
import { ENGINE_ORDER, unsupportedInfo } from '../registry'
import { retryLimit } from '../retry'
import { DEFAULT_SETTINGS, type EngineSettingsFile } from '../store'
import type { HostContext, Runtime } from './context'

const PHASE_ORDER: EngineJob['phase'][] = ['prepare', 'download', 'install']

/** 按一行输出猜安装 / 更新走到哪一步了（下载 → 安装）；只往前走，认不出时保持原样 */
export function jobPhase(line: string, current: EngineJob['phase']): EngineJob['phase'] {
  const guess = /install|extract|unpack|setting up|added \d+ package|changed \d+ package|安装|解压/i.test(line)
    ? 'install'
    : /download|fetch|http|下载/i.test(line)
      ? 'download'
      : null
  if (!guess) return current === 'prepare' ? 'download' : current
  return PHASE_ORDER.indexOf(guess) > PHASE_ORDER.indexOf(current) ? guess : current
}

export class HostSettings {
  /** 当前设置；只整体替换，不原地修改 */
  file: EngineSettingsFile
  /** npm 上查到的最新版本（checkEngineUpdates），engines() 带进引擎信息 */
  private readonly latest: Partial<Record<EngineId, string>> = {}
  /** 正在安装 / 更新的引擎 → 在做哪一种 */
  private readonly updating = new Map<EngineId, EngineJob['action']>()

  constructor(private readonly ctx: HostContext) {
    this.file = ctx.store.loadSettings()
  }

  async engines(force = false): Promise<EngineInfo[]> {
    const list = (
      await Promise.all(
        ENGINE_ORDER.map(id => this.ctx.adapters[id]?.info(force) ?? Promise.resolve(unsupportedInfo(id))),
      )
    ).map(info => (this.latest[info.id] ? { ...info, latestVersion: this.latest[info.id] } : info))
    if (force) this.ctx.opts.emit({ kind: 'engines', engines: list })
    return list
  }

  defaults(): EngineDefaults {
    return { ...this.file.defaults, ...this.engineDefaults(this.file.defaults.engine) }
  }

  /** 一个引擎的新会话默认值；旧版只有一份全局默认，没单独记过的引擎沿用它（docs/ui/engine-settings-redesign.md §4） */
  engineDefaults(engine: EngineId): SessionDefaults {
    const d = this.file.defaults
    const legacy: SessionDefaults = {
      model: d.model,
      effort: d.effort,
      permissionMode: d.permissionMode,
      ultracode: d.ultracode,
      fast: d.fast,
      thinkingSummaries: d.thinkingSummaries,
    }
    return { ...legacy, ...(this.file.engineDefaults[engine] ?? {}) }
  }

  /** 会话里改推理强度那几项时是否也记成新会话的默认值（GitHub #6，默认不记） */
  remembersChoices(engine: EngineId): boolean {
    return this.file.options[engine]?.rememberChoices === true
  }

  launchOptions(engine: EngineId): {
    outputStyle: string | null
    askQuestions: boolean
    autoCompactPct: number | null
    args: string[]
  } {
    const o = this.file.options[engine] ?? {}
    return {
      outputStyle: o.outputStyle ?? null,
      askQuestions: o.askQuestions !== false,
      autoCompactPct: o.autoCompactPct ?? null,
      // 设置文件是用户可改的 JSON，读出来再过一遍
      args: Array.isArray(o.args) ? o.args.filter((a): a is string => typeof a === 'string') : [],
    }
  }

  /** 启动进程要用到的全部引擎级设置；和进程启动时的不同，就在下一条消息前重启进程（--resume 接上原对话） */
  launchKey(engine: EngineId): string {
    return JSON.stringify([this.file.paths[engine] ?? null, this.file.env[engine] ?? {}, this.launchOptions(engine)])
  }

  engineConfig(): EngineConfig {
    const one = (id: EngineId): EngineLocalConfig => ({
      path: this.file.paths[id] ?? null,
      env: { ...(this.file.env[id] ?? {}) },
      compactModel: this.file.compactModels[id] ?? null,
      defaults: this.engineDefaults(id),
      ...this.launchOptions(id),
      hidden: this.file.options[id]?.hidden === true && id !== this.file.defaults.engine,
      rememberChoices: this.remembersChoices(id),
    })
    return Object.fromEntries(ENGINE_ORDER.map(id => [id, one(id)])) as EngineConfig
  }

  async setEngineConfig(engine: EngineId, patch: EngineConfigPatch): Promise<EngineConfig> {
    if (!ENGINE_ORDER.includes(engine)) throw new Error('未知引擎')
    const next: EngineSettingsFile = {
      ...this.file,
      paths: { ...this.file.paths },
      env: { ...this.file.env },
      compactModels: { ...this.file.compactModels },
      engineDefaults: { ...this.file.engineDefaults },
      options: { ...this.file.options },
    }
    const options = { ...(next.options[engine] ?? {}) }
    let redetect = false
    // 替换的命令和追加的参数先交给适配器查，找不到、不允许就不保存（docs/ui/engine-launch.md §3）
    const path = patch.path !== undefined ? (patch.path?.trim() ?? '') : undefined
    const args = patch.args !== undefined ? checkArgs(patch.args) : undefined
    if (path || args?.length) this.ctx.adapters[engine]?.checkLaunch?.(path || null, args ?? [])
    if (path !== undefined) {
      if (path) next.paths[engine] = path
      else delete next.paths[engine]
      redetect = true
    }
    if (args !== undefined) {
      if (args.length > 0) options.args = args
      else delete options.args
      redetect = true
    }
    if (patch.env !== undefined) {
      const env: Record<string, string> = {}
      const before = next.env[engine] ?? {}
      for (const [k, v] of Object.entries(patch.env)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`环境变量名不对：${k}`)
        if (typeof v !== 'string') throw new Error(`环境变量 ${k} 的值不对`)
        // 接口地址和 Key 改在「自定义 API」里配（docs/ui/custom-api.md §3.4）：已有的照旧生效，只能删除或迁移
        if (PROVIDER_ENV.includes(k.toUpperCase()) && before[k] !== v) throw codedError('env.reserved', { name: k })
        env[k] = v
      }
      if (Object.keys(env).length > 0) next.env[engine] = env
      else delete next.env[engine]
      redetect = true
    }
    if (patch.compactModel !== undefined) {
      const m = patch.compactModel?.trim() ?? ''
      if (m) next.compactModels[engine] = m
      else delete next.compactModels[engine]
    }
    if (patch.defaults !== undefined)
      next.engineDefaults[engine] = { ...this.engineDefaults(engine), ...checkDefaults(patch.defaults) }
    if (patch.outputStyle !== undefined) {
      const style = patch.outputStyle?.trim() ?? ''
      if (style.length > 100) throw new Error('输出风格名字太长')
      if (style) options.outputStyle = style
      else delete options.outputStyle
    }
    if (patch.askQuestions !== undefined) {
      if (typeof patch.askQuestions !== 'boolean') throw new Error('「允许中途向我提问」的值不对')
      if (patch.askQuestions) delete options.askQuestions
      else options.askQuestions = false
    }
    if (patch.autoCompactPct !== undefined) {
      const pct = patch.autoCompactPct
      if (pct !== null && !(AUTO_COMPACT_PCTS as readonly number[]).includes(pct)) throw new Error('自动压缩触发点不对')
      if (pct === null) delete options.autoCompactPct
      else options.autoCompactPct = pct
    }
    if (patch.hidden !== undefined) {
      if (typeof patch.hidden !== 'boolean') throw new Error('「在菜单中显示」的值不对')
      if (patch.hidden && engine === this.file.defaults.engine) throw new Error('默认引擎不能隐藏，先换一个默认引擎')
      if (patch.hidden) options.hidden = true
      else delete options.hidden
    }
    if (patch.rememberChoices !== undefined) {
      if (typeof patch.rememberChoices !== 'boolean') throw new Error('「记住会话里的选择」的值不对')
      if (patch.rememberChoices) options.rememberChoices = true
      else delete options.rememberChoices
    }
    if (Object.keys(options).length > 0) next.options[engine] = options
    else delete next.options[engine]
    this.ctx.store.saveSettings(next)
    this.file = next
    if (redetect) await this.engines(true)
    const config = this.engineConfig()
    this.ctx.opts.emit({ kind: 'engine_config', config })
    return config
  }

  setDefaultEngine(engine: EngineId): EngineDefaults {
    if (!ENGINE_ORDER.includes(engine) || !this.ctx.adapters[engine]) throw new Error('这个引擎暂不支持')
    const options = { ...this.file.options }
    if (options[engine]?.hidden) {
      const { hidden: _hidden, ...rest } = options[engine]!
      if (Object.keys(rest).length > 0) options[engine] = rest
      else delete options[engine]
    }
    this.file = { ...this.file, defaults: { ...this.file.defaults, engine }, options }
    this.ctx.store.saveSettings(this.file)
    this.ctx.opts.emit({ kind: 'engine_config', config: this.engineConfig() })
    return this.defaults()
  }

  async engineCatalog(engine: EngineId, force = false): Promise<EngineCatalog> {
    const adapter = this.ctx.adapters[engine]
    return adapter?.catalog ? adapter.catalog(force) : { outputStyles: [], currentOutputStyle: null }
  }

  async updateEngine(engine: EngineId): Promise<EngineUpdateResult> {
    const adapter = this.ctx.adapters[engine]
    if (!adapter?.update) throw new Error('这个引擎不支持在软件里更新')
    return this.runJob(engine, 'update', async onLine => {
      if (adapter.updateNeedsIdle) await this.releaseIdleProcesses(engine)
      return adapter.update!(onLine)
    })
  }

  /** 一键安装：只有检测结果说能装（installable）时才跑，装完重新检测 */
  async installEngine(engine: EngineId): Promise<EngineUpdateResult> {
    const adapter = this.ctx.adapters[engine]
    if (!adapter?.install) throw new Error('这个引擎不支持在软件里安装')
    const info = await adapter.info()
    if (info.status !== 'missing') throw new Error('已经装好了，请刷新')
    if (!info.installable) throw new Error(info.message ?? '这台电脑上没法一键安装，请按提示在终端安装')
    return this.runJob(engine, 'install', onLine => adapter.install!(onLine))
  }

  /**
   * 安装和更新共用：同一个引擎同时只跑一个；过程推 engine_job（阶段 + 最后一行输出，最多每 250 ms 一次），
   * 结束（成功或失败）都重新检测并广播引擎列表
   */
  private async runJob(
    engine: EngineId,
    action: EngineJob['action'],
    work: (onLine: (line: string) => void) => Promise<EngineUpdateResult>,
  ): Promise<EngineUpdateResult> {
    const busy = this.updating.get(engine)
    if (busy) throw new Error(busy === 'install' ? '正在安装，请稍候' : '正在更新，请稍候')
    this.updating.set(engine, action)
    let job: EngineJob = { engine, action, phase: 'prepare', startedAt: Date.now(), line: null, error: null }
    let sentAt = 0
    const emit = (next: EngineJob, force = false): void => {
      const changed = next.phase !== job.phase
      job = next
      if (!force && !changed && Date.now() - sentAt < 250) return
      sentAt = Date.now()
      if (!this.ctx.closing) this.ctx.opts.emit({ kind: 'engine_job', job })
    }
    emit(job, true)
    try {
      const result = await work(line => emit({ ...job, phase: jobPhase(line, job.phase), line }))
      emit({ ...job, phase: 'verify' }, true)
      const list = await this.engines(true)
      const version = list.find(e => e.id === engine)?.version ?? null
      const ok = result.ok && (action === 'update' || list.find(e => e.id === engine)?.status !== 'missing')
      const error = ok ? null : result.output.split('\n').pop() || '没有成功，请看输出'
      emit({ ...job, phase: ok ? 'done' : 'failed', error }, true)
      return { ...result, ok, version }
    } catch (err) {
      emit({ ...job, phase: 'failed', error: (err as Error).message }, true)
      throw err
    } finally {
      this.updating.delete(engine)
    }
  }

  /** 更新前关掉这个引擎空闲的进程（和空闲超时一样，下一条消息时接上原对话）；有任务在跑就不更新 */
  private async releaseIdleProcesses(engine: EngineId): Promise<void> {
    const idle: Runtime[] = []
    for (const rt of this.ctx.runtimes.values()) {
      if (!rt.session || (rt.execution ?? rt.snapshot.record).engine !== engine) continue
      if (rt.snapshot.state !== 'idle') throw new Error('有这个引擎的任务正在运行，等它们结束后再更新')
      idle.push(rt)
    }
    await Promise.all(
      idle.map(rt => {
        if (rt.idleTimer) clearTimeout(rt.idleTimer)
        rt.idleTimer = null
        const s = rt.session!
        rt.session = null
        return s.close().catch(() => undefined)
      }),
    )
  }

  /**
   * 查各引擎在 npm 上的最新版本（宿主选项 latestVersion，桌面端定时调用）；有变化时广播引擎列表。
   * 查不到的保留上次的结果
   */
  async checkEngineUpdates(): Promise<void> {
    const fetchLatest = this.ctx.opts.latestVersion
    if (!fetchLatest) return
    let changed = false
    await Promise.all(
      ENGINE_ORDER.map(async id => {
        const pkg = this.ctx.adapters[id]?.npmPackage
        const version = pkg ? await fetchLatest(pkg).catch(() => null) : null
        if (version && version !== this.latest[id]) {
          this.latest[id] = version
          changed = true
        }
      }),
    )
    if (changed && !this.ctx.closing) this.ctx.opts.emit({ kind: 'engines', engines: await this.engines() })
  }

  /**
   * 设置云同步（docs/ui/settings-sync.md §3）：只交出白名单里的字段——默认引擎、各引擎的新会话默认值和压缩模型、
   * 输出风格 / 提问 / 自动压缩 / 菜单里隐藏、请求重试。命令路径、追加参数、环境变量（可能有密钥）出不去。
   */
  syncable(): SyncableEngineSettings {
    const engines = <T>(pick: (id: EngineId) => T): Partial<Record<EngineId, T>> =>
      Object.fromEntries(ENGINE_ORDER.filter(id => this.ctx.adapters[id]).map(id => [id, pick(id)]))
    return {
      'desktop.engine.defaults': {
        engine: this.file.defaults.engine,
        engines: engines(id => ({
          defaults: this.engineDefaults(id),
          compactModel: this.file.compactModels[id] ?? null,
        })),
      },
      'desktop.engine.options': {
        engines: engines(id => {
          const o = this.file.options[id] ?? {}
          return {
            outputStyle: o.outputStyle ?? null,
            askQuestions: o.askQuestions !== false,
            autoCompactPct: o.autoCompactPct ?? null,
            hidden: o.hidden === true,
            rememberChoices: o.rememberChoices === true,
          }
        }),
      },
      'desktop.engine.retries': this.file.maxRetries,
    }
  }

  /**
   * 把云端的值写回本机：走和设置页一样的校验（setEngineConfig / setDefaultEngine / setRetrySettings），
   * 哪一项不合法就跳过那一项、保留本机的值。null 表示云端删了这个键：恢复默认。
   */
  async applySyncable(key: string, value: unknown): Promise<void> {
    const obj = (v: unknown): Record<string, unknown> =>
      v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
    const each = async (patchOf: (raw: Record<string, unknown>) => EngineConfigPatch): Promise<void> => {
      const engines = obj(obj(value).engines)
      for (const id of ENGINE_ORDER) {
        if (!this.ctx.adapters[id]) continue
        try {
          await this.setEngineConfig(id, patchOf(obj(engines[id])))
        } catch {
          /* 这台电脑上不合法（例如默认引擎不能隐藏）：保留本机的 */
        }
      }
    }
    if (key === 'desktop.engine.defaults') {
      const engine = obj(value).engine
      if (value !== null && typeof engine === 'string' && (ENGINE_ORDER as readonly string[]).includes(engine))
        try {
          if (engine !== this.file.defaults.engine) this.setDefaultEngine(engine as EngineId)
        } catch {
          /* 这台电脑没有这个引擎 */
        }
      await each(raw => ({
        defaults: value === null ? { ...DEFAULT_SETTINGS.defaults } : (obj(raw.defaults) as Partial<SessionDefaults>),
        compactModel: typeof raw.compactModel === 'string' ? raw.compactModel : null,
      }))
    } else if (key === 'desktop.engine.options') {
      await each(raw => ({
        outputStyle: typeof raw.outputStyle === 'string' ? raw.outputStyle : null,
        askQuestions: raw.askQuestions !== false,
        autoCompactPct: typeof raw.autoCompactPct === 'number' ? raw.autoCompactPct : null,
        hidden: raw.hidden === true,
        rememberChoices: raw.rememberChoices === true,
      }))
    } else if (key === 'desktop.engine.retries') {
      try {
        this.setRetrySettings(value)
      } catch {
        /* 不合法的次数：保留本机的 */
      }
    }
  }

  retrySettings(): { maxRetries: number | null } {
    return { maxRetries: this.file.maxRetries }
  }

  setRetrySettings(value: unknown): { maxRetries: number | null } {
    const maxRetries = retryLimit(value)
    const next = { ...this.file, maxRetries }
    this.ctx.store.saveSettings(next)
    this.file = next
    const settings = this.retrySettings()
    this.ctx.opts.emit({ kind: 'retry_settings', settings })
    return settings
  }

  setDefaults(patch: Partial<EngineDefaults>): EngineDefaults {
    const engine = patch.engine ?? this.file.defaults.engine
    const { engine: _engine, platform: _platform, provider: _provider, ...rest } = patch
    const next: SessionDefaults = { ...this.engineDefaults(engine), ...checkDefaults(rest) }
    this.file = { ...this.file, engineDefaults: { ...this.file.engineDefaults, [engine]: next } }
    this.ctx.store.saveSettings(this.file)
    // 输入框里的「默认：…」读的是引擎配置，记住选择以后跟着变
    this.ctx.opts.emit({ kind: 'engine_config', config: this.engineConfig() })
    return this.defaults()
  }
}

/** 追加参数的通用检查（各引擎不允许的参数由适配器的 checkLaunch 查）：字符串数组、不太长、第一个是选项 */
function checkArgs(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(a => typeof a !== 'string' || a.includes('\0')))
    throw codedError('launch.invalidArgs')
  if (value.length > 100 || value.some(a => a.length > 4000)) throw codedError('launch.argsTooLong')
  const args = value as string[]
  if (args.length > 0 && !args[0].startsWith('-')) throw codedError('launch.firstArg', { arg: args[0] })
  return args
}

/** 校验新会话默认值的补丁，只留认识的字段 */
function checkDefaults(patch: Partial<SessionDefaults>): Partial<SessionDefaults> {
  const out: Partial<SessionDefaults> = {}
  if (patch.model !== undefined) {
    if (patch.model !== null && typeof patch.model !== 'string') throw new Error('默认模型不对')
    out.model = patch.model?.trim() || null
  }
  if (patch.effort !== undefined) {
    if (patch.effort !== null && !EFFORTS.includes(patch.effort)) throw new Error('默认推理强度不对')
    out.effort = patch.effort
  }
  if (patch.permissionMode !== undefined) {
    if (!PERMISSION_MODES.includes(patch.permissionMode)) throw new Error('默认权限不对')
    out.permissionMode = patch.permissionMode
  }
  for (const key of ['ultracode', 'fast', 'thinkingSummaries'] as const) {
    if (patch[key] === undefined) continue
    if (typeof patch[key] !== 'boolean') throw new Error(`默认设置 ${key} 的值不对`)
    out[key] = patch[key]
  }
  return out
}

/** 设置云同步里引擎的三个键（docs/ui/settings-sync.md §3） */
export interface SyncableEngineSettings {
  'desktop.engine.defaults': {
    engine: EngineId
    engines: Partial<Record<EngineId, { defaults: SessionDefaults; compactModel: string | null }>>
  }
  'desktop.engine.options': {
    engines: Partial<
      Record<
        EngineId,
        {
          outputStyle: string | null
          askQuestions: boolean
          autoCompactPct: number | null
          hidden: boolean
          rememberChoices: boolean
        }
      >
    >
  }
  'desktop.engine.retries': number | null
}
