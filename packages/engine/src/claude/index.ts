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
  viaGateway,
} from '@pixelsky/protocol'
import type { EngineAdapter, EngineSession, Launcher, SessionContext } from '../adapter'
import { engineEnv } from '../env'
import { outputTail, runStream, startupReason } from '../exec'
import { engineBase } from '../registry'
import { claudeInstaller, customClaude, discoverClaude, type ClaudeDiscovery } from './discover'
import { rewindFilesOnce, sideQuestionOnce, type HelperTarget, type RewindFilesReply } from './helper'
import { ClaudeProcess } from './process'
import { ClaudeSession, reservedClaudeArg, type ClaudeLaunchOptions } from './session'
import { loadSavedRuns, loadSubagentTranscript } from './runs'
import { claudeSessionDir, defaultProjectsDir, findClaudeTranscript, findRewindAnchor } from './transcript'
import { claudeModelName } from './long-context'

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

/** 平台线路在请求重试设置为「跟随引擎」时的上限；自定义了就按自定义（docs/ui/error-retry.md） */
export const PLATFORM_MAX_RETRIES = 3

export class ClaudeAdapter implements EngineAdapter {
  private cached: ClaudeDiscovery | null = null
  private detecting: Promise<ClaudeDiscovery> | null = null
  private catalogCache: { at: number; value: EngineCatalog } | null = null
  private probing: Promise<EngineCatalog> | null = null
  /** 原生安装器和 npm 装的版本号一致，都按这个包查最新版本 */
  readonly npmPackage = '@anthropic-ai/claude-code'

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

  /** 会话进程和辅助进程共用的环境：平台网关变量、重试次数、自动压缩点、文件检查点、插件 PATH */
  private launchEnv(
    record: SessionRecord,
    maxRetries: number | null,
    pathDirs: readonly string[] = [],
  ): NodeJS.ProcessEnv {
    const env = this.env()
    const platformEnv = this.opts.sessionEnv?.(record)
    if (viaGateway(record)) {
      if (!platformEnv?.PIXELSKY_GATEWAY_SETTINGS) throw new Error('本机网关不可用，请重启应用')
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
    if (maxRetries !== null) env.CLAUDE_CODE_MAX_RETRIES = String(maxRetries)
    const launch = this.opts.launchOptions?.()
    // 自动压缩触发点（docs/ui/engine-settings-redesign.md §3.2）：上下文用到窗口的这个百分比时压缩
    if (launch?.autoCompactPct) env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = String(launch.autoCompactPct)
    // 文件检查点：-p 模式默认不记，回退时要靠它恢复代码（docs/ui/rewind-fork-sidechat.md §1）；
    // 用户设了 CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING 时 Claude Code 自己会关掉
    env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = 'true'
    if (pathDirs.length) env.PATH = [...pathDirs, env.PATH ?? env.Path ?? ''].join(delimiter)
    return env
  }

  private readyLauncher(record: SessionRecord): Launcher {
    const d = this.cached
    if (!d?.launcher || (d.info.status !== 'ready' && !(viaGateway(record) && d.info.status === 'unauthenticated')))
      throw new Error(d?.info.message ?? 'Claude Code 不可用')
    return d.launcher
  }

  createSession(ctx: SessionContext): EngineSession {
    const launcher = this.readyLauncher(ctx.record())
    const d = this.cached!
    // 设置是「跟随引擎」时，平台线路也只重试 PLATFORM_MAX_RETRIES 次：Claude Code 自己默认约 10 次，
    // 网络中途断开时每次都重发整段上下文、重新计费（压缩请求不走缓存，一次就要几毛钱）
    const maxRetries = ctx.maxRetries ?? (ctx.record().platform ? PLATFORM_MAX_RETRIES : null)
    const env = this.launchEnv(ctx.record(), maxRetries, ctx.extensions?.pathDirs)
    const launch = this.opts.launchOptions?.()
    return new ClaudeSession(ctx, {
      maxRetries,
      launch: launch
        ? { outputStyle: launch.outputStyle, askQuestions: launch.askQuestions, args: launch.args }
        : undefined,
      launcher,
      env,
      projectsDir: this.opts.projectsDir ?? d.projectsDir ?? defaultProjectsDir(env),
      steeringValidated: this.opts.steeringValidated,
      extensions: ctx.extensions,
    })
  }

  /** 辅助进程：--resume 这个会话，平台会话带网关设置 */
  private helperTarget(record: SessionRecord): HelperTarget {
    const sid = record.engineSessionId
    if (!sid || !findClaudeTranscript(this.projectsDir(), record.cwd, sid))
      throw new Error('这个会话还没有 Claude Code 记录')
    const env = this.launchEnv(record, null)
    const gateway = viaGateway(record) ? env.PIXELSKY_GATEWAY_SETTINGS : undefined
    return {
      launcher: this.readyLauncher(record),
      cwd: record.cwd,
      env,
      resumeArgs: ['--resume', sid, ...(gateway ? ['--settings', gateway] : [])],
    }
  }

  /** 回退恢复代码：预览（dryRun）或真的还原到这条用户消息之前（docs/ui/rewind-fork-sidechat.md §1） */
  async rewindFiles(record: SessionRecord, userItemId: string, dryRun: boolean): Promise<RewindFilesReply> {
    return rewindFilesOnce(this.helperTarget(record), userItemId, dryRun)
  }

  /** 旁聊：带着这个会话的上下文单独问一次，没有工具、不写记录（docs/ui/rewind-fork-sidechat.md §3） */
  async sideQuestion(record: SessionRecord, prompt: string, signal: AbortSignal): Promise<string> {
    const target = this.helperTarget(record)
    return sideQuestionOnce(target, prompt, record.model && claudeModelName(record.model, target.env), signal)
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
  async update(onLine: (line: string) => void = () => undefined): Promise<EngineUpdateResult> {
    const d = await this.discover(false)
    if (!d.launcher) throw new Error(d.info.message ?? '没找到 Claude Code')
    const r = await runStream(d.launcher, ['update'], this.env(), 5 * 60_000, onLine)
    this.catalogCache = null
    // 版本由宿主重新检测后填上（重新检测会广播给界面）
    return { ok: r.ok, output: outputTail(r), version: null }
  }

  /** 一键安装：跑官方安装器（最多 10 分钟），装到 ~/.local/bin，检测本来就会找那里 */
  async install(onLine: (line: string) => void = () => undefined): Promise<EngineUpdateResult> {
    const installer = claudeInstaller(this.env())
    if (!installer) throw new Error('没找到 PowerShell / curl，请按提示在终端安装 Claude Code')
    const r = await runStream(installer, [], this.env(), 10 * 60_000, onLine)
    this.catalogCache = null
    return { ok: r.ok, output: outputTail(r), version: null }
  }
}
