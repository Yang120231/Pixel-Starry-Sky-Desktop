import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EngineAdapter, EngineSession, Launcher, LoginProcess, SessionContext } from '../adapter'
import {
  type AgentRuns,
  codedError,
  type EngineCatalog,
  type EngineInfo,
  type EngineUpdateResult,
  type Item,
  type SessionRecord,
  viaGateway,
} from '@pixelsky/protocol'
import { engineEnv } from '../env'
import { outputTail, run, runInteractive, startupReason } from '../exec'
import { engineBase } from '../registry'
import { customCodex, discoverCodex, toolEnvironment } from './discover'
import { codexAnchor, readCodexTurns } from './branch'
import { CodexProcess, object } from './process'
import { codexCatalog } from './catalog'
import { CodexSession, reservedCodexArg, type CodexLaunchOptions } from './session'
import { CodexTranslator } from './translate'
import { loadCodexRuns } from './runs'
import { CODEX_NPM_PACKAGE, installCodexWithNpm, updateCodexWithNpm } from './update'
import { array } from './process'

export interface CodexAdapterOptions {
  /** 用户在设置里替换的命令（绝对路径或 PATH 上的命令名，docs/ui/engine-launch.md） */
  overridePath?: () => string | null
  env?: NodeJS.ProcessEnv
  extraEnv?: () => Record<string, string>
  sessionEnv?: (record: SessionRecord) => NodeJS.ProcessEnv
  launcher?: Launcher
  launchOptions?: () => CodexLaunchOptions
}
export class CodexAdapter implements EngineAdapter {
  private cached: { info: EngineInfo; launcher: Launcher | null } | null = null
  private detecting: Promise<EngineInfo> | null = null
  private catalogCache: EngineCatalog | null = null
  /** Codex 带着 Default 模式提问开关起不来过：之后的会话不再带（重新检测时清掉，升级后可能就认得了） */
  private askRejected = false
  /** Codex 报过的各模型窗口（GitHub #20）：设了自动压缩、没填窗口时按它算 token 数 */
  private readonly knownWindows = new Map<string, number>()
  readonly npmPackage = CODEX_NPM_PACKAGE
  readonly updateNeedsIdle = true
  /** thread id 由 Codex 分配：宿主不预先塞 id（docs/codex-engine.md 回退 / 分叉一节） */
  readonly enginePicksSessionId = true
  /** 跨引擎接力：别的引擎期间的聊天用 thread/inject_items 注入线程（chat-log.ts） */
  readonly seedsHistory = true
  private env(): NodeJS.ProcessEnv {
    return { ...engineEnv(this.opts.env ?? process.env), ...this.opts.extraEnv?.() }
  }
  constructor(private readonly opts: CodexAdapterOptions = {}) {}
  checkLaunch(command: string | null, args: readonly string[]): void {
    if (command) {
      const custom = customCodex(command, this.env())
      if ('error' in custom) throw new Error(custom.error)
    }
    const reserved = reservedCodexArg(args)
    if (reserved) throw codedError('launch.reserved', { arg: reserved })
  }
  /** 用户追加的启动参数（检测握手、读子智能体记录也带上，参数让进程起不来时检测就能看到） */
  private launchArgs(): string[] {
    return this.opts.launchOptions?.().args ?? []
  }
  /** 一键更新：npm 全局装的用 npm install -g（docs/ui/engine-update.md）；宿主随后重新检测 */
  async update(onLine?: (line: string) => void): Promise<EngineUpdateResult> {
    await this.info()
    const exe = this.cached?.info.path
    if (!exe) throw new Error(this.cached?.info.message ?? '没找到 Codex')
    const result = await updateCodexWithNpm(exe, this.env(), onLine)
    this.catalogCache = null
    return result
  }
  /** 授权登录：codex login（浏览器）或 codex login --device-auth（设备码）；用检测到的原生程序，npm 垫片不经 shell 起不来 */
  async login(method: 'browser' | 'device', onLine: (line: string) => void): Promise<LoginProcess> {
    const launcher = await this.loginLauncher()
    const args = method === 'device' ? ['login', '--device-auth'] : ['login']
    return runInteractive(launcher, args, toolEnvironment(launcher, this.env()), onLine)
  }
  /** 取消授权：codex logout */
  async logout(): Promise<EngineUpdateResult> {
    const launcher = await this.loginLauncher()
    const r = await run(launcher, ['logout'], toolEnvironment(launcher, this.env()))
    return { ok: r.ok, output: outputTail(r), version: null }
  }
  private async loginLauncher(): Promise<Launcher> {
    await this.info()
    const launcher = this.cached?.launcher
    if (!launcher) throw new Error(this.cached?.info.message ?? '没找到 Codex')
    return launcher
  }
  /** 一键安装：npm install -g（找得到 npm 时 info.installable 才为真） */
  async install(onLine: (line: string) => void = () => undefined): Promise<EngineUpdateResult> {
    const result = await installCodexWithNpm(this.env(), onLine)
    this.catalogCache = null
    return result
  }
  async info(force = false): Promise<EngineInfo> {
    if (this.cached && !force) return this.cached.info
    if (this.detecting) return this.detecting
    this.detecting = this.detect().finally(() => {
      this.detecting = null
    })
    return this.detecting
  }
  private async detect(): Promise<EngineInfo> {
    this.askRejected = false
    const result = this.opts.launcher
      ? {
          info: {
            ...engineBase('codex'),
            status: 'ready' as const,
            version: null,
            path: this.opts.launcher.command,
            message: null,
          },
          launcher: this.opts.launcher,
        }
      : await discoverCodex(this.opts.overridePath?.() ?? null, this.env())
    this.cached = result
    if (!result.launcher || result.info.status !== 'ready') return result.info
    let stderr = ''
    const proc = new CodexProcess(
      result.launcher,
      ['app-server', '--listen', 'stdio://', ...this.launchArgs()],
      process.cwd(),
      toolEnvironment(result.launcher, this.env()),
      {
        notification() {},
        request: id => proc.respondError(id, 'No interactive session'),
        exit: (_code, tail) => (stderr = tail),
      },
    )
    try {
      await proc.initialize()
      this.catalogCache = await codexCatalog(proc)
      const auth = await proc.request('account/read', { refreshToken: false })
      // 已授权的账号（ChatGPT 登录有邮箱和套餐；API Key 登录没有）
      const account = object(auth.account)
      const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
      const found = { email: text(account.email), plan: text(account.planType) }
      const filled = Object.fromEntries(Object.entries(found).filter(([, v]) => v))
      if (Object.keys(filled).length) result.info.account = filled
      if (auth.requiresOpenaiAuth === false) {
        // config.toml 里配了自己的接口：不用登录也能跑，codex logout 取消不掉它
        result.info.auth = { kind: 'provider', provider: this.catalogCache.currentProvider ?? undefined }
      } else if (account.type === 'apiKey') result.info.auth = { kind: 'apiKey' }
      else if (Object.keys(account).length) result.info.auth = { kind: 'login' }
      else if (auth.requiresOpenaiAuth === true) {
        result.info.status = 'unauthenticated'
        result.info.message = 'Codex is not signed in. Run codex login.'
      }
    } catch (error) {
      result.info.status = 'error'
      result.info.message = startupReason(stderr) || (error as Error).message
      // 追加了参数或替换了命令：原因也显示在「启动」卡片上（docs/ui/engine-launch.md §9.3）
      if (this.launchArgs().length || result.info.launch === 'custom') result.info.launchError = result.info.message
    } finally {
      await proc.close()
    }
    return result.info
  }
  async catalog(force = false): Promise<EngineCatalog> {
    await this.info(force)
    return this.catalogCache ?? { outputStyles: [], currentOutputStyle: null }
  }
  async subagentTranscript(record: SessionRecord, agentId: string): Promise<Item[]> {
    if (!this.cached?.launcher || !/^[A-Za-z0-9-]{1,100}$/.test(agentId)) throw new Error('Invalid Codex subagent')
    const proc = new CodexProcess(
      this.cached.launcher,
      ['app-server', ...this.launchArgs()],
      record.cwd,
      toolEnvironment(this.cached.launcher, this.env()),
      { notification() {}, request: id => proc.respondError(id, 'Read-only history'), exit() {} },
    )
    try {
      await proc.initialize()
      const result = await proc.request('thread/read', { threadId: agentId, includeTurns: true })
      const translator = new CodexTranslator(() => {})
      for (const turn of array(object(result.thread).turns))
        for (const item of array(object(turn).items)) translator.item(object(item), true, false)
      return [...translator.items.values()]
    } finally {
      await proc.close()
    }
  }
  /**
   * 回退 / 分叉的截断点：起一个临时 app-server 冷读线程的轮次（不 resume），按用户消息 clientId 求「最后保留的一轮」。
   * 读不到（没装、线程没了、没有 clientId）返回 null，宿主按「找不到」处理
   */
  async rewindAnchor(record: SessionRecord, userItemIds: string[]): Promise<{ at: string | null } | null> {
    if (!record.engineSessionId) return null
    let proc: CodexProcess | undefined
    try {
      await this.info()
      const launcher = this.cached?.launcher
      if (!launcher || this.cached?.info.status === 'error') return null
      const p: CodexProcess = (proc = new CodexProcess(
        launcher,
        ['app-server', '--listen', 'stdio://', ...this.launchArgs()],
        record.cwd,
        this.sessionEnvironment(launcher, record),
        { notification() {}, request: id => p.respondError(id, 'Read-only history'), exit() {} },
      ))
      await p.initialize()
      return codexAnchor(await readCodexTurns(p, record.engineSessionId), userItemIds)
    } catch {
      return null
    } finally {
      await proc?.close()
    }
  }
  /** 会话和读历史的临时进程共用的环境：平台 / 自定义接口会话去掉 OpenAI 登录变量，带上网关变量 */
  private sessionEnvironment(launcher: Launcher, record: SessionRecord): NodeJS.ProcessEnv {
    const env = toolEnvironment(launcher, this.env())
    env.PIXELSKY_CODEX_PROVIDER = this.catalogCache?.currentProvider ?? 'openai'
    if (viaGateway(record)) {
      for (const key of Object.keys(env)) if (/^(OPENAI_|CODEX_ACCESS_TOKEN|CHATGPT_)/i.test(key)) delete env[key]
      Object.assign(env, this.opts.sessionEnv?.(record) ?? {})
    }
    return env
  }
  createSession(ctx: SessionContext): EngineSession {
    const result = this.cached
    if (
      !result?.launcher ||
      (result.info.status !== 'ready' && !(viaGateway(ctx.record()) && result.info.status === 'unauthenticated'))
    )
      throw new Error(result?.info.message ?? 'Codex is unavailable')
    const env = this.sessionEnvironment(result.launcher, ctx.record())
    return new CodexSession(result.launcher, env, ctx, {
      version: result.info.version,
      askRejected: () => this.askRejected,
      rejectAsk: () => (this.askRejected = true),
      ...(this.opts.launchOptions?.() ?? { askQuestions: true }),
      defaultModel: () => this.catalogCache?.currentModel ?? null,
      knownWindows: this.knownWindows,
      savedAgents: () => this.loadRuns(ctx.record()).agents,
    })
  }
  /** 子智能体追踪从线程的 rollout 还原（读不到就是空的） */
  loadRuns(record: SessionRecord): AgentRuns {
    if (!record.engineSessionId) return { workflows: [], agents: [] }
    const env = viaGateway(record) ? { ...this.env(), ...this.opts.sessionEnv?.(record) } : this.env()
    return loadCodexRuns(env.CODEX_HOME || join(homedir(), '.codex'), record.engineSessionId)
  }
}
