import type { EngineAdapter, EngineSession, Launcher, SessionContext } from '../adapter'
import {
  codedError,
  type EngineCatalog,
  type EngineInfo,
  type Item,
  type SessionRecord,
  viaGateway,
} from '@pixelsky/protocol'
import { engineEnv } from '../env'
import { startupReason } from '../exec'
import { engineBase } from '../registry'
import { customCodex, discoverCodex, toolEnvironment } from './discover'
import { CodexProcess, object } from './process'
import { codexCatalog } from './catalog'
import { CodexSession, reservedCodexArg, type CodexLaunchOptions } from './session'
import { CodexTranslator } from './translate'
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
  async info(force = false): Promise<EngineInfo> {
    if (this.cached && !force) return this.cached.info
    if (this.detecting) return this.detecting
    this.detecting = this.detect().finally(() => {
      this.detecting = null
    })
    return this.detecting
  }
  private async detect(): Promise<EngineInfo> {
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
      if (!Object.keys(object(auth.account)).length && auth.requiresOpenaiAuth === true) {
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
        for (const item of array(object(turn).items)) translator.item(object(item), true)
      return [...translator.items.values()]
    } finally {
      await proc.close()
    }
  }
  createSession(ctx: SessionContext): EngineSession {
    const result = this.cached
    if (
      !result?.launcher ||
      (result.info.status !== 'ready' && !(viaGateway(ctx.record()) && result.info.status === 'unauthenticated'))
    )
      throw new Error(result?.info.message ?? 'Codex is unavailable')
    const env = toolEnvironment(result.launcher, this.env())
    env.PIXELSKY_CODEX_PROVIDER = this.catalogCache?.currentProvider ?? 'openai'
    if (viaGateway(ctx.record())) {
      for (const key of Object.keys(env)) if (/^(OPENAI_|CODEX_ACCESS_TOKEN|CHATGPT_)/i.test(key)) delete env[key]
      Object.assign(env, this.opts.sessionEnv?.(ctx.record()) ?? {})
    }
    return new CodexSession(result.launcher, env, ctx, this.opts.launchOptions?.() ?? { askQuestions: true })
  }
}
