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
  type EngineLocalConfig,
  type EngineUpdateResult,
  type SessionDefaults,
} from '@pixelsky/protocol'
import { ENGINE_ORDER, unsupportedInfo } from '../registry'
import { retryLimit } from '../retry'
import type { EngineSettingsFile } from '../store'
import type { HostContext } from './context'

export class HostSettings {
  /** 当前设置；只整体替换，不原地修改 */
  file: EngineSettingsFile

  constructor(private readonly ctx: HostContext) {
    this.file = ctx.store.loadSettings()
  }

  async engines(force = false): Promise<EngineInfo[]> {
    const list = await Promise.all(
      ENGINE_ORDER.map(id => this.ctx.adapters[id]?.info(force) ?? Promise.resolve(unsupportedInfo(id))),
    )
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
    const result = await adapter.update()
    const list = await this.engines(true)
    return { ...result, version: list.find(e => e.id === engine)?.version ?? null }
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
