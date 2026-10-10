// Claude Code 适配器
import { homedir } from 'node:os'
import { delimiter } from 'node:path'
import {
  EFFORTS,
  codedError,
  type AgentRuns,
  type Effort,
  type EngineCatalog,
  type EngineInfo,
  type EngineModel,
  type EngineUpdateResult,
  type Item,
  type SessionRecord,
} from '@pixelsky/protocol'
import type { EngineAdapter, EngineSession, Launcher, SessionContext } from '../adapter'
import { engineEnv } from '../env'
import { run, startupReason } from '../exec'
import { engineBase } from '../registry'
import { customClaude, discoverClaude, type ClaudeDiscovery } from './discover'
import { ClaudeProcess } from './process'
import { ClaudeSession, reservedClaudeArg, type ClaudeLaunchOptions } from './session'
import { loadSavedRuns, loadSubagentTranscript } from './runs'
import { claudeSessionDir, defaultProjectsDir, findClaudeTranscript, findRewindAnchor } from './transcript'

export interface ClaudeAdapterOptions {
  sessionEnv?: (record: SessionRecord) => NodeJS.ProcessEnv
  /** 用户在设置里替换的命令（绝对路径或 PATH 上的命令名，docs/ui/engine-launch.md） */
  overridePath?: () => string | null
  /** 基础环境变量（默认 process.env，启动前会清理） */
  env?: NodeJS.ProcessEnv
  /** 用户在设置里追加的环境变量（在清理后的基础环境之上；平台会话的网关变量仍然最后覆盖） */
  extraEnv?: () => Record<string, string>
  /** 设置 › 本机引擎里的引擎级选项（输出风格、允许提问、自动压缩触发点、追加参数），每次启动进程时读 */
  launchOptions?: () => ClaudeLaunchOptions & { autoCompactPct: number | null }
  /** 测试用：直接指定要启动的程序，跳过查找和检测 */
  launcher?: Launcher
  /** 测试用：Claude 会话记录目录 */
  projectsDir?: string
  /** 明确通过真实追加输入验证后由宿主开放；桌面正式配置当前不设置。 */
  steeringValidated?: boolean
}

/** 输出风格列表的缓存时间 */
const CATALOG_TTL = 5 * 60_000

function isEffort(x: unknown): x is Effort {
  return typeof x === 'string' && (EFFORTS as readonly string[]).includes(x)
}

/**
 * 握手回包里的 models（Claude Code 的字段：value、displayName、description、resolvedModel、supportsEffort、supportedEffortLevels）
 * 转成目录模型。value 为 default 的一项不进列表（界面已有「默认」行）。
 */
export function claudeModels(raw: unknown): EngineModel[] {
  if (!Array.isArray(raw)) return []
  const out: EngineModel[] = []
  for (const m of raw as unknown[]) {
    if (!m || typeof m !== 'object') continue
    const o = m as Record<string, unknown>
    if (typeof o.value !== 'string' || o.value === 'default') continue
    const levels = o.supportsEffort === false || !Array.isArray(o.supportedEffortLevels) ? [] : o.supportedEffortLevels
    out.push({
      id: o.value,
      label: typeof o.displayName === 'string' && o.displayName ? o.displayName : o.value,
      description: typeof o.description === 'string' ? o.description : undefined,
      resolved: typeof o.resolvedModel === 'string' ? o.resolvedModel : undefined,
      efforts: levels.filter(isEffort),
      defaultEffort: null,
      inputModalities: ['text', 'image'],
      isDefault: false,
    })
  }
  return out
}

export class ClaudeAdapter implements EngineAdapter {
  private cached: ClaudeDiscovery | null = null
  private detecting: Promise<ClaudeDiscovery> | null = null
  private catalogCache: { at: number; value: EngineCatalog } | null = null
  private probing: Promise<EngineCatalog> | null = null

  constructor(private readonly opts: ClaudeAdapterOptions = {}) {}

  private env(): NodeJS.ProcessEnv {
    return { ...engineEnv(this.opts.env ?? process.env), ...(this.opts.extraEnv?.() ?? {}) }
  }

  private discover(force: boolean): Promise<ClaudeDiscovery> {
    if (this.cached && !force) return Promise.resolve(this.cached)
    // 重新检测时命令或参数可能变了，输出风格列表也要重新握手
    if (force) this.catalogCache = null
    if (!this.detecting) {
      this.detecting = this.detect()
        .then(d => (this.cached = d))
        .finally(() => {
          this.detecting = null
        })
    }
    return this.detecting
  }

  private async detect(): Promise<ClaudeDiscovery> {
    const d: ClaudeDiscovery = this.opts.launcher
      ? {
          info: {
            ...engineBase('claude'),
            status: 'ready',
            version: null,
            path: this.opts.launcher.command,
            message: null,
          },
          launcher: this.opts.launcher,
          projectsDir: this.opts.projectsDir ?? null,
        }
      : await discoverClaude(this.opts.overridePath?.() ?? null, this.env())
    // 追加了参数：再握手一次。--version 不检查其它参数，写错的参数要以会话的方式启动才报（docs/ui/engine-launch.md §9.2）。
    // 失败只记原因、不标为不可用：这里在主目录启动，相对路径的参数在项目目录里可能是对的
    if (d.launcher && this.launchArgs().length && (d.info.status === 'ready' || d.info.status === 'unauthenticated')) {
      const r = await this.handshake(d.launcher)
      if (r && 'error' in r) d.info.launchError = r.error
      else if (r) this.catalogCache = { at: Date.now(), value: r.catalog }
    }
    return d
  }

  /** 用户追加的启动参数 */
  private launchArgs(): string[] {
    return this.opts.launchOptions?.().args ?? []
  }

  async info(force = false): Promise<EngineInfo> {
    return (await this.discover(force)).info
  }

  checkLaunch(command: string | null, args: readonly string[]): void {
    if (command) {
      const custom = customClaude(command, this.env())
      if ('error' in custom) throw new Error(custom.error)
    }
    const reserved = reservedClaudeArg(args)
    if (reserved) throw codedError('launch.reserved', { arg: reserved })
  }

  private projectsDir(): string {
    return this.opts.projectsDir ?? this.cached?.projectsDir ?? defaultProjectsDir(this.env())
  }

  private sessionDir(record: SessionRecord): string | null {
    return claudeSessionDir(this.projectsDir(), record.cwd, record.engineSessionId ?? record.id)
  }

  loadRuns(record: SessionRecord): AgentRuns {
    const dir = this.sessionDir(record)
    return dir ? loadSavedRuns(dir) : { workflows: [], agents: [] }
  }

  rewindAnchor(record: SessionRecord, userItemIds: string[]): { at: string | null } | null {
    const file = findClaudeTranscript(this.projectsDir(), record.cwd, record.engineSessionId ?? record.id)
    return file ? findRewindAnchor(file, userItemIds) : null
  }

  subagentTranscript(record: SessionRecord, agentId: string): Item[] {
    const dir = this.sessionDir(record)
    if (!dir) throw new Error('这个会话还没有保存记录')
    return loadSubagentTranscript(dir, agentId, record.cwd)
  }

  createSession(ctx: SessionContext): EngineSession {
    const d = this.cached
    if (!d?.launcher || (d.info.status !== 'ready' && !(ctx.record().platform && d.info.status === 'unauthenticated')))
      throw new Error(d?.info.message ?? 'Claude Code 不可用')
    const env = this.env()
    const platformEnv = this.opts.sessionEnv?.(ctx.record())
    if (ctx.record().platform) {
      if (!platformEnv) throw new Error('平台代理不可用，请重启应用')
      for (const key of Object.keys(env)) {
        if (
          /^(ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY)/i.test(
            key,
          )
        )
          delete env[key]
      }
      Object.assign(env, platformEnv)
    }
    const maxRetries = ctx.maxRetries ?? null
    if (maxRetries !== null) env.CLAUDE_CODE_MAX_RETRIES = String(maxRetries)
    const launch = this.opts.launchOptions?.()
    // 自动压缩触发点（docs/ui/engine-settings-redesign.md §3.2）：上下文用到窗口的这个百分比时压缩
    if (launch?.autoCompactPct) env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = String(launch.autoCompactPct)
    if (ctx.extensions?.pathDirs.length)
      env.PATH = [...ctx.extensions.pathDirs, env.PATH ?? env.Path ?? ''].join(delimiter)
    return new ClaudeSession(ctx, {
      maxRetries,
      launch: launch
        ? { outputStyle: launch.outputStyle, askQuestions: launch.askQuestions, args: launch.args }
        : undefined,
      launcher: d.launcher,
      env,
      projectsDir: this.opts.projectsDir ?? d.projectsDir ?? defaultProjectsDir(env),
      steeringValidated: this.opts.steeringValidated,
      extensions: ctx.extensions,
    })
  }

  /**
   * 输出风格列表：启动一个 Claude Code 进程，只做初始化握手（initialize 控制请求）就结束，
   * 不发消息、不调用模型。握手回包里有 available_output_styles 和 output_style（docs/ui/engine-settings-redesign.md §5）。
   */
  async catalog(force = false): Promise<EngineCatalog> {
    if (!force && this.catalogCache && Date.now() - this.catalogCache.at < CATALOG_TTL) return this.catalogCache.value
    if (this.probing) return this.probing
    this.probing = this.probe(force)
      .then(value => {
        this.catalogCache = { at: Date.now(), value }
        return value
      })
      .finally(() => {
        this.probing = null
      })
    return this.probing
  }

  private async probe(force: boolean): Promise<EngineCatalog> {
    // 检测正在进行时（追加了参数会握手）等它做完，它的握手结果就是这里要的
    const d = await (this.detecting ?? this.discover(false))
    if (!force && this.catalogCache && Date.now() - this.catalogCache.at < CATALOG_TTL) return this.catalogCache.value
    const r =
      d.launcher && (d.info.status === 'ready' || d.info.status === 'unauthenticated')
        ? await this.handshake(d.launcher)
        : null
    return r && 'catalog' in r ? r.catalog : { outputStyles: [], currentOutputStyle: null }
  }

  /**
   * 以会话的方式启动一个 Claude Code 进程（带上追加的参数），只做初始化握手就结束。
   * 回应前进程就退出了给出原因；超时或别的失败返回 null。
   */
  private async handshake(launcher: Launcher): Promise<{ catalog: EngineCatalog } | { error: string } | null> {
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']
    const proc = new ClaudeProcess(launcher, [...args, ...this.launchArgs()], homedir(), this.env(), {
      onMessage: () => undefined,
      onControlRequest: () => undefined,
      onControlCancel: () => undefined,
      onExit: () => undefined,
    })
    try {
      const init = await proc.request('initialize', {}, 30_000)
      const styles = Array.isArray(init.available_output_styles)
        ? init.available_output_styles.filter((x): x is string => typeof x === 'string')
        : []
      return {
        catalog: {
          outputStyles: styles,
          currentOutputStyle: typeof init.output_style === 'string' ? init.output_style : null,
          models: claudeModels(init.models),
        },
      }
    } catch (err) {
      if (proc.alive) return null
      return { error: startupReason(proc.stderrTail) || (err as Error).message }
    } finally {
      proc.kill()
    }
  }

  /** 检查更新：运行 claude update（最多 5 分钟） */
  async update(): Promise<EngineUpdateResult> {
    const d = await this.discover(false)
    if (!d.launcher) throw new Error(d.info.message ?? '没找到 Claude Code')
    const r = await run(d.launcher, ['update'], this.env(), 5 * 60_000)
    const output = [r.stdout, r.stderr]
      .join('\n')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .slice(-6)
      .join('\n')
    this.catalogCache = null
    // 版本由宿主重新检测后填上（重新检测会广播给界面）
    return { ok: r.ok, output: output || (r.error ?? ''), version: null }
  }
}
