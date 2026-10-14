import { delimiter } from 'node:path'
import type {
  ApprovalDecision,
  ApprovalRequest,
  ContextWindows,
  EngineCatalog,
  ImageAttachment,
  SessionSettings,
  SkillCommand,
  TurnOutcome,
} from '@pixelsky/protocol'
import { EMPTY_FLAGS, isQuietWarning, viaGateway } from '@pixelsky/protocol'
import { QUICK_CLOSE_MS, type CloseOptions, type EngineSession, type Launcher, type SessionContext } from '../adapter'
import { CodexProcess, array, object, string, type Message } from './process'
import { codexCatalog } from './catalog'
import { codexChanges, CodexTranslator, tokenCounts } from './translate'
import { CODEX_WINDOW_ENV, codexContextConfig } from './context-config'

export interface CodexLaunchOptions {
  askQuestions: boolean
  steeringValidated?: boolean
  /** 用户追加的启动参数，放在 app-server --listen stdio:// 后面、像素星空自己的 -c 前面（docs/ui/engine-launch.md §3） */
  args?: string[]
  /** 自动压缩触发点（百分比）；null 用 Codex 自己的（GitHub #20） */
  autoCompactPct?: number | null
  /** 云端 / 本机模型填的上下文窗口 */
  contextWindows?: ContextWindows
  /** 会话用默认模型时，Codex 报的当前模型 */
  defaultModel?: () => string | null
  /** Codex 报过的各模型窗口（没改窗口时记下），算自动压缩的 token 数用 */
  knownWindows?: Map<string, number>
}

/** 用户追加的参数里第一个由像素星空控制的（docs/ui/engine-launch.md §3）：--listen，改平台线路的 -c；都允许时返回 null */
export function reservedCodexArg(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--listen' || arg.startsWith('--listen=')) return '--listen'
    let value: string | undefined
    if (arg === '-c' || arg === '--config') value = args[i + 1]
    else if (arg.startsWith('--config=')) value = arg.slice('--config='.length)
    else if (arg.startsWith('-c') && !arg.startsWith('--')) value = arg.slice(2).replace(/^=/, '')
    if (value === undefined) continue
    const key = value.split('=')[0].trim()
    if (key === 'model_provider' || key === 'model_providers' || key.startsWith('model_providers.pixelsky'))
      return `-c ${key}`
  }
  return null
}
/** Codex TurnError 里 message 之外的原始信息（附加说明、错误类型、HTTP 状态码），给界面「详情」用；没有时为 null */
export function turnErrorDetail(raw: unknown, willRetry?: unknown): string | null {
  const error = object(raw),
    lines: string[] = []
  const details = string(error.additionalDetails).trim()
  if (details) lines.push(details)
  const info = error.codexErrorInfo
  if (typeof info === 'string' && info) lines.push(`type: ${info}`)
  else if (info && typeof info === 'object')
    for (const [kind, value] of Object.entries(info as Record<string, unknown>)) {
      lines.push(`type: ${kind}`)
      const status = object(value).httpStatusCode
      if (typeof status === 'number') lines.push(`HTTP status: ${status}`)
    }
  if (!lines.length) return null
  if (typeof willRetry === 'boolean') lines.push(`will retry: ${willRetry ? 'yes' : 'no'}`)
  return lines.join('\n')
}

export function codexPermission(mode: string, cwd?: string): Message {
  return mode === 'full'
    ? { approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } }
    : mode === 'plan'
      ? { approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly', networkAccess: false } }
      : {
          approvalPolicy: mode === 'ask' ? 'untrusted' : 'on-request',
          sandboxPolicy: {
            type: 'workspaceWrite',
            writableRoots: cwd ? [cwd] : [],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
        }
}
type Approval = { id: string | number; method: string; params: Message; request: ApprovalRequest }
export function tomlValue(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(tomlValue).join(', ') + ']'
  if (value && typeof value === 'object')
    return (
      '{ ' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([key, v]) => JSON.stringify(key) + ' = ' + tomlValue(v))
        .join(', ') +
      ' }'
    )
  return JSON.stringify(value)
}
export class CodexSession implements EngineSession {
  private proc: CodexProcess | null = null
  private opening: Promise<void> | null = null
  private closed = false
  private threadId: string | null = null
  private nativeTurnId: string | null = null
  private readonly finishedTurns = new Set<string>()
  private active: {
    id: string
    started: number
    model: string
    baseline: ReturnType<typeof tokenCounts>
    usageSeen: boolean
    activity: boolean
  } | null = null
  private settings: SessionSettings
  private catalog: EngineCatalog | null = null
  private readonly approvals = new Map<string, Approval>()
  private readonly guidance = new Map<
    string,
    { text: string; attachments: ImageAttachment[]; accepted: boolean; observed: boolean }
  >()
  private readonly earlyConsumed = new Set<string>()
  private skills: SkillCommand[] = []
  private totals = tokenCounts({})
  private last = tokenCounts({})
  private contextWindow: number | null = null
  private compacting = false
  private translator: CodexTranslator
  private reportedError: string | null = null
  /** 同一毫秒内的多条报错也要各自保留，id 不能只靠时间戳 */
  private noticeSeq = 0
  /** 启动时带了 model_context_window：报上来的窗口是设置的值，不记成 Codex 自己的 */
  private windowOverridden = false
  /** 已经发过的配置类警告（Codex 每轮都发一次），同一会话只出一次 */
  private readonly quietShown = new Set<string>()
  /** 上一轮带了计划协作模式：切到别的权限后，下一轮要带一次 default 切回来 */
  private planSent = false
  /** thread/start 报的模型：会话跟随引擎默认、目录也没写当前模型时，计划模式用它 */
  private threadModel: string | null = null
  /** 停止后等待 turn/completed 的回调，finish() 时统一唤醒 */
  private turnWaiters: Array<() => void> = []

  constructor(
    private readonly launcher: Launcher,
    private readonly env: NodeJS.ProcessEnv,
    private readonly ctx: SessionContext,
    private readonly options: CodexLaunchOptions,
  ) {
    this.settings = { ...ctx.record() }
    this.translator = new CodexTranslator(
      event => this.ctx.emit(event),
      () => this.last.total || null,
    )
  }
  private async open(): Promise<void> {
    if (this.closed) throw new Error('Codex session is closed')
    if (this.threadId && this.proc?.alive) return
    if (this.opening) return this.opening
    this.opening = this.connect().finally(() => {
      this.opening = null
    })
    return this.opening
  }
  private async connect(): Promise<void> {
    const record = this.ctx.record(),
      environment = { ...this.env },
      // 用户追加的参数放在像素星空自己的 -c 前面：同一个配置项写两次时后写的生效
      args = ['app-server', '--listen', 'stdio://', ...(this.options.args ?? [])]
    const config = (key: string, value: unknown): void => {
      args.push('-c', `${key}=${tomlValue(value)}`)
    }
    // 平台和自定义 API 都经本机网关；provider 名分开，Codex 按 provider 存的状态互不串
    const gatewayProvider = record.platform ? 'pixelsky' : record.provider ? 'pixelsky-custom' : null
    if (gatewayProvider) {
      const base = environment.PIXELSKY_CODEX_BASE_URL
      if (!base || !environment.PIXELSKY_CODEX_TOKEN) throw new Error('Codex gateway is unavailable')
      const p = `model_providers.${gatewayProvider}`
      config('model_provider', gatewayProvider)
      config(`${p}.name`, record.platform ? 'Pixel Starry Sky' : 'Custom API')
      config(`${p}.base_url`, base)
      config(`${p}.wire_api`, 'responses')
      config(`${p}.env_key`, 'PIXELSKY_CODEX_TOKEN')
      config(`${p}.requires_openai_auth`, false)
      config(`${p}.supports_websockets`, false)
    }
    if (this.ctx.maxRetries !== null && this.ctx.maxRetries !== undefined) {
      const provider = gatewayProvider ?? string(environment.PIXELSKY_CODEX_PROVIDER)
      // 两层同时使用 N 会放大为 (N+1)² 次请求。自定义仅控制 HTTP
      // 请求层，禁用整条流重新发起；null 保留原生两层策略。
      if (provider) {
        config(`model_providers.${provider}.request_max_retries`, this.ctx.maxRetries)
        config(`model_providers.${provider}.stream_max_retries`, 0)
      }
    }
    Object.assign(environment, this.ctx.extensions?.env)
    if (this.ctx.extensions?.pathDirs.length) {
      const key = Object.keys(environment).find(k => k.toLowerCase() === 'path') ?? 'PATH'
      environment[key] = [...this.ctx.extensions.pathDirs, environment[key] ?? ''].join(delimiter)
    }
    const ext = this.ctx.extensions
    for (const [key, value] of Object.entries(ext?.codexConfig ?? {})) config(key, value)
    // 上下文窗口和自动压缩（GitHub #20）：放在用户追加的参数后面，同一项以设置为准
    const model = record.model ?? this.options.defaultModel?.() ?? null
    const context = codexContextConfig({
      record,
      model,
      windows: this.options.contextWindows,
      autoCompactPct: this.options.autoCompactPct,
      providerWindow: environment[CODEX_WINDOW_ENV],
      known: model ? this.options.knownWindows?.get(model) : null,
    })
    delete environment[CODEX_WINDOW_ENV]
    if (context.window) config('model_context_window', context.window)
    if (context.limit) config('model_auto_compact_token_limit', context.limit)
    this.windowOverridden = !!context.window
    const proc = new CodexProcess(this.launcher, args, record.cwd, environment, {
      notification: (method, params) => this.notification(method, params),
      request: (id, method, params) => this.request(id, method, params),
      exit: (_code, tail) => {
        if (this.proc !== proc) return
        if (!this.closed && this.active) this.finish('failed', tail || 'Codex process exited')
        this.threadId = null
      },
    })
    this.proc = proc
    try {
      // 额外技能根、turn/start 的 collaborationMode（计划模式）都是实验字段，一律声明实验接口（docs/codex-engine.md §3.5）
      await proc.initialize(true)
      if (ext?.skillRoots?.length) await proc.request('skills/extraRoots/set', { extraRoots: ext.skillRoots })
      this.catalog = await codexCatalog(proc)
      const requirements = await proc.request('configRequirements/read').catch(() => ({}))
      const allowed = array(object(object(requirements).requirements).allowedApprovalPolicies)
      const policy = codexPermission(this.settings.permissionMode)
      if (allowed.length && !allowed.includes(policy.approvalPolicy))
        throw new Error('Codex managed requirements prohibit this permission mode')
      const threadParams = {
        cwd: record.cwd,
        ...(record.model ? { model: record.model } : {}),
        approvalPolicy: policy.approvalPolicy,
        sandbox:
          this.settings.permissionMode === 'full'
            ? 'danger-full-access'
            : this.settings.permissionMode === 'plan'
              ? 'read-only'
              : 'workspace-write',
      }
      let thread: Message,
        resumeFailed = false
      if (record.engineSessionId)
        try {
          thread = await proc.request('thread/resume', { threadId: record.engineSessionId, ...threadParams })
        } catch (error) {
          // 进程已经退出说明是连接问题，照常报错；进程还在说明线程找不到或已损坏，改用新线程
          if (!proc.alive) throw error
          thread = await proc.request('thread/start', threadParams)
          resumeFailed = true
        }
      else thread = await proc.request('thread/start', threadParams)
      this.threadId = string(object(thread.thread).id)
      this.threadModel = string(thread.model) || null
      // 恢复的线程可能还停在计划模式（上次退出前选的计划）：按它报的实际模式算，下一轮需要时切回 default
      this.planSent = string(object(thread.collaborationMode).mode) === 'plan'
      if (!this.threadId) throw new Error('Codex did not return a thread ID')
      this.ctx.setEngineSessionId(this.threadId)
      if (resumeFailed)
        this.ctx.emit({
          type: 'item_completed',
          item: {
            kind: 'notice',
            id: `cx-resume-${Date.now()}-${++this.noticeSeq}`,
            level: 'warn',
            text: 'Could not resume the Codex thread; started a new thread (previous context was not carried over)',
            detail: null,
          },
        })
      this.emitFlags()
      const skills = await proc
        .request('skills/list', {
          cwds: [record.cwd],
          forceReload: !!ext?.skillRoots?.length,
          ...(ext?.skillRoots?.length ? { perCwdExtraUserRoots: { [record.cwd]: ext.skillRoots } } : {}),
        })
        .catch(() => ({}))
      this.skills = array(object(skills).data)
        .flatMap(raw => array(object(raw).skills))
        .flatMap(raw => {
          const skill = object(raw)
          return skill.enabled === false || !string(skill.name) || !string(skill.path)
            ? []
            : [
                {
                  name: string(skill.name),
                  description: string(skill.description),
                  source: 'engine' as const,
                  invocation: 'skill' as const,
                  path: string(skill.path),
                },
              ]
        })
      this.ctx.emit({
        type: 'commands',
        commands: [
          {
            name: 'compact',
            description: 'Summarize the conversation to free up context',
            source: 'engine',
            builtin: true,
            invocation: 'slash',
          },
          ...this.skills,
        ],
      })
    } catch (error) {
      this.proc = null
      await proc.close()
      throw error
    }
  }
  private input(text: string, attachments: ImageAttachment[]): Message[] {
    const input: Message[] = text ? [{ type: 'text', text, text_elements: [] }] : []
    for (const image of attachments)
      input.push({ type: 'image', url: `data:${image.mediaType};base64,${image.dataBase64}` })
    const match = /^\$([^\s]+)(?:\s|$)/.exec(text)
    const skill = this.skills.find(s => s.name === match?.[1])
    if (skill?.path) input.push({ type: 'skill', name: skill.name, path: skill.path })
    return input
  }
  send(text: string, turnId: string, userItemId: string, attachments: ImageAttachment[] = []): void {
    if (this.active) {
      this.ctx.emit({ type: 'turn_completed', turnId, outcome: 'failed', error: 'Codex turn already running' })
      return
    }
    this.active = {
      id: turnId,
      started: Date.now(),
      model: this.settings.model ?? this.catalog?.currentModel ?? '',
      baseline: { ...this.totals },
      usageSeen: false,
      activity: false,
    }
    this.translator = new CodexTranslator(
      event => this.ctx.emit(event),
      () => this.last.total || null,
    )
    this.nativeTurnId = null
    this.reportedError = null
    const active = this.active
    void this.run(text, userItemId, attachments).catch(error => {
      if (this.active === active) this.finish('failed', (error as Error).message)
    })
  }
  private async run(text: string, userItemId: string, attachments: ImageAttachment[]): Promise<void> {
    const active = this.active
    await this.open()
    if (!this.active || this.active !== active || this.closed) return
    const selected = this.catalog?.models?.find(m => m.id === (this.settings.model ?? this.catalog?.currentModel))
    this.active.baseline = { ...this.totals }
    if (attachments.length && (!selected || !selected.inputModalities.includes('image')))
      throw new Error('This Codex model does not support images')
    if (this.settings.effort && selected && !selected.efforts.includes(this.settings.effort))
      throw new Error('This Codex model does not support the selected effort')
    this.active.model = this.settings.model ?? this.catalog?.currentModel ?? 'Codex'
    if (text === '/compact') {
      this.compacting = true
      this.ctx.emit({
        type: 'context',
        context: {
          model: this.active.model,
          used: this.last.total || null,
          window: null,
          input: null,
          cacheRead: null,
          cacheWrite: null,
          output: null,
          observedAt: Date.now(),
          source: 'request',
          stale: true,
          compacting: true,
          diagnostic: null,
          diagnosticStale: true,
        },
      })
      await this.proc!.request('thread/compact/start', { threadId: this.threadId })
    } else {
      const result = await this.proc!.request('turn/start', {
        threadId: this.threadId,
        clientUserMessageId: userItemId,
        input: this.input(text, attachments),
        ...codexPermission(this.settings.permissionMode, this.ctx.record().cwd),
        ...(this.settings.model ? { model: this.settings.model } : {}),
        ...(this.settings.effort ? { effort: this.settings.effort } : {}),
        summary: this.settings.thinkingSummaries ? 'concise' : 'none',
        ...this.collaboration(),
        ...this.serviceTier(),
      })
      const turnId = string(object(result.turn).id)
      if (this.active === active) this.nativeTurnId = turnId || this.nativeTurnId
      else if (turnId) {
        // 开轮途中已经停止（本地已结束），原生那一轮可能仍在执行：补发中断，并丢弃它之后的事件
        this.markFinished(turnId)
        this.proc?.request('turn/interrupt', { threadId: this.threadId, turnId }).catch(() => {})
      }
      this.ctx.emit({ type: 'input_ack', id: userItemId, state: 'consumed', mode: 'normal' })
    }
  }
  async update(patch: Partial<SessionSettings>): Promise<void> {
    if (this.active) return
    this.settings = { ...this.settings, ...patch }
    // 换模型、换线路后 Fast 能不能开跟着变；目录还没读到时等 open() 再报
    if (
      this.catalog &&
      (patch.model !== undefined ||
        patch.fast !== undefined ||
        patch.platform !== undefined ||
        patch.provider !== undefined)
    )
      this.emitFlags()
  }
  /** 当前模型开 Fast 用的服务档位 */
  private fastTier(): string | undefined {
    const id = this.settings.model ?? this.catalog?.currentModel ?? this.threadModel
    return this.catalog?.models?.find(m => m.id === id)?.fastTier
  }
  /**
   * Fast 开不了的原因（docs/codex-engine.md §3.5）：走平台 / 自定义接口、provider 不是 openai 时没核实档位加价，
   * 当前模型没有 Fast 档位时也不行；能开时 null
   */
  private fastBlocked(): string | null {
    if (viaGateway(this.ctx.record()) || (this.catalog?.currentProvider ?? 'openai') !== 'openai')
      return 'codex_gateway'
    return this.fastTier() ? null : 'model_not_allowed'
  }
  private emitFlags(): void {
    const blocked = this.fastBlocked()
    if (blocked && this.settings.fast) {
      this.settings.fast = false
      this.ctx.setFast(false)
    }
    this.ctx.emit({
      type: 'flags',
      flags: {
        ...EMPTY_FLAGS,
        compactAvailable: true,
        contextAvailable: false,
        steerAvailable: this.options.steeringValidated === true,
        fastAvailable: !blocked,
        fastState: this.settings.fast ? 'on' : 'off',
        fastBlocked: blocked,
        ultracodeAvailable: false,
      },
    })
  }
  /**
   * 计划模式用 Codex 原生的计划协作模式（模型才有提问工具 request_user_input）；它会一直沿用，
   * 所以从计划切到别的权限后要带一次 default 切回来。developer_instructions 为 null 时用 Codex 内置的指令
   */
  private collaboration(): Message {
    const plan = this.settings.permissionMode === 'plan'
    if (!plan && !this.planSent) return {}
    const model = this.settings.model ?? this.catalog?.currentModel ?? this.threadModel
    if (!model) throw new Error('Codex plan mode needs a model')
    this.planSent = plan
    return {
      collaborationMode: {
        mode: plan ? 'plan' : 'default',
        settings: { model, reasoning_effort: this.settings.effort ?? null, developer_instructions: null },
      },
    }
  }
  /** Fast：能开时每轮都写明档位（开 priority、关 default），以界面开关为准；开不了时不带，用 Codex 自己的配置 */
  private serviceTier(): Message {
    if (this.fastBlocked()) return {}
    return { serviceTier: this.settings.fast ? (this.fastTier() ?? 'priority') : 'default' }
  }
  async steer(text: string, id: string, attachments: ImageAttachment[] = []): Promise<void> {
    if (!this.active || !this.nativeTurnId || !this.options.steeringValidated)
      throw new Error('Codex active turn cannot accept guidance')
    this.guidance.set(id, { text, attachments, accepted: false, observed: false })
    try {
      const result = await this.proc!.request('turn/steer', {
        threadId: this.threadId,
        expectedTurnId: this.nativeTurnId,
        clientUserMessageId: id,
        input: this.input(text, attachments),
      })
      if (string(result.turnId) !== this.nativeTurnId && this.active) throw new Error('Codex guidance turn mismatch')
      const pending = this.guidance.get(id)
      if (pending) {
        pending.accepted = true
        if (pending.observed) this.consume(id)
      }
    } catch (error) {
      this.guidance.delete(id)
      throw error
    }
  }
  private consume(id: string): void {
    if (this.guidance.delete(id)) this.ctx.emit({ type: 'input_ack', id, state: 'consumed', mode: 'guidance' })
  }
  private notification(method: string, params: Message): void {
    // 子智能体的审批也在这里结束，先于按线程过滤
    if (method === 'serverRequest/resolved') {
      const id = String(params.requestId)
      if (this.approvals.delete(id)) this.ctx.emit({ type: 'approval_resolved', requestId: id })
      return
    }
    const eventThread = string(params.threadId)
    if (eventThread && this.threadId && eventThread !== this.threadId) return
    if (!this.active) return
    const eventTurn = string(params.turnId || object(params.turn).id)
    if (eventTurn && this.finishedTurns.has(eventTurn)) return
    if (eventTurn && this.nativeTurnId && eventTurn !== this.nativeTurnId) return
    if (method === 'turn/started') this.nativeTurnId = string(object(params.turn).id)
    else if (method === 'turn/completed') {
      const turn = object(params.turn)
      this.finish(
        turn.status === 'interrupted' ? 'interrupted' : turn.status === 'failed' ? 'failed' : 'completed',
        string(object(turn.error).message) || null,
        turnErrorDetail(turn.error),
      )
    } else if (method === 'item/started' || method === 'item/completed') {
      const item = object(params.item)
      if (item.type === 'userMessage') {
        const id = string(item.clientId || item.clientUserMessageId),
          pending = this.guidance.get(id)
        if (pending) {
          pending.observed = true
          if (pending.accepted) this.consume(id)
        }
      } else {
        this.active.activity = true
        this.translator.item(item, method === 'item/completed')
      }
    } else if (
      /^item\/(agentMessage|plan)\/delta$|^item\/reasoning\/summaryTextDelta$|^item\/commandExecution\/outputDelta$/.test(
        method,
      )
    )
      this.translator.delta(method, params)
    else if (method === 'turn/plan/updated') this.translator.plan(params)
    else if (method === 'thread/tokenUsage/updated') {
      const usage = object(params.tokenUsage)
      this.totals = tokenCounts(usage.total)
      this.last = tokenCounts(usage.last)
      this.translator.usage(this.last.total)
      if (!this.active.activity) {
        this.active.baseline = { ...this.totals }
        this.active.usageSeen = true
      } else if (!this.active.usageSeen) {
        for (const key of ['input', 'cacheRead', 'cacheWrite', 'output', 'total'] as const)
          this.active.baseline[key] = Math.max(0, this.totals[key] - this.last[key])
        this.active.usageSeen = true
      }
      const window = typeof usage.modelContextWindow === 'number' ? usage.modelContextWindow : null
      this.contextWindow = window
      if (window && !this.windowOverridden && this.active.model)
        this.options.knownWindows?.set(this.active.model, window)
      this.ctx.emit({
        type: 'usage',
        usage: {
          inputTokens: this.totals.input,
          outputTokens: this.totals.output,
          cacheReadTokens: this.totals.cacheRead,
          cacheWriteTokens: this.totals.cacheWrite,
          contextTokens: this.last.total,
          contextWindow: window,
          costUsd: null,
        },
      })
      this.ctx.emit({
        type: 'context',
        context: {
          model: this.active.model,
          used: this.last.total,
          window,
          input: this.last.input,
          cacheRead: this.last.cacheRead,
          cacheWrite: this.last.cacheWrite,
          output: this.last.output,
          observedAt: Date.now(),
          source: 'request',
          stale: false,
          compacting: false,
          diagnostic: null,
          diagnosticStale: true,
        },
      })
    } else if (method === 'error' || method === 'warning') {
      const text = string(object(params.error).message || params.message)
      if (method === 'error') this.reportedError = text
      // 用户 config.toml 引起、不影响使用的警告：灰色提示，同一会话只出一次（docs/ui/ai-commit-codex-warnings-history.md §3）
      const quiet = method === 'warning' && isQuietWarning(text)
      if (quiet && this.quietShown.has(text)) return
      if (quiet) this.quietShown.add(text)
      this.ctx.emit({
        type: 'item_completed',
        item: {
          kind: 'notice',
          id: `cx-${method}-${Date.now()}-${++this.noticeSeq}`,
          level: method === 'error' ? 'error' : quiet ? 'info' : 'warn',
          text,
          detail: turnErrorDetail(params.error, params.willRetry),
        },
      })
    }
  }
  private request(id: string | number, method: string, params: Message): void {
    // 每个会话一个 app-server 进程，里面别的线程只能是这一轮派出的子智能体：照常弹审批，标题带上是哪个
    const thread = string(params.threadId),
      subagent = !!thread && !!this.threadId && thread !== this.threadId
    if (!this.active || (!subagent && params.turnId && this.nativeTurnId && params.turnId !== this.nativeTurnId)) {
      this.proc?.respondError(id, 'No matching active turn')
      return
    }
    const agent = this.translator.agents.get(thread)?.label ?? thread.slice(0, 8)
    const title = (main: string, sub: string): string => (subagent ? sub.replace('{agent}', agent) : main)
    const key = String(id),
      // 子智能体的条目不在主对话里，卡片不挂到条目上
      itemId = params.itemId && !subagent ? 'cx-' + string(params.itemId) : null
    let request: ApprovalRequest
    if (method === 'item/commandExecution/requestApproval')
      request = {
        requestId: key,
        itemId,
        kind: 'command',
        title: params.networkApprovalContext
          ? title('Codex network access', 'Codex subagent {agent} network access')
          : title('Codex command approval', 'Codex subagent {agent} command approval'),
        command: string(params.command),
        description: string(params.reason),
        input: params.networkApprovalContext,
        alwaysScopes: ['session'],
      }
    else if (method === 'item/fileChange/requestApproval')
      request = {
        requestId: key,
        itemId,
        kind: 'file_change',
        title: title('Codex file changes', 'Codex subagent {agent} file changes'),
        changes: codexChanges(params.changes ?? (itemId && object(this.translator.items.get(itemId)).changes)),
        description: string(params.reason),
        alwaysScopes: ['session'],
      }
    else if (method === 'item/tool/requestUserInput') {
      if (!this.options.askQuestions) {
        this.proc?.respond(id, { answers: {} })
        return
      }
      request = {
        requestId: key,
        itemId,
        kind: 'question',
        title: title('Codex question', 'Codex subagent {agent} question'),
        questions: array(params.questions).map(raw => {
          const question = object(raw)
          return {
            id: string(question.id),
            question: string(question.question),
            header: string(question.header),
            multiSelect: false,
            allowOther: question.isOther === true,
            secret: question.isSecret === true,
            options: array(question.options).map(o => ({
              label: string(object(o).label),
              description: string(object(o).description),
            })),
          }
        }),
        alwaysScopes: [],
      }
    } else if (method === 'item/permissions/requestApproval' || method === 'mcpServer/elicitation/request')
      request = {
        requestId: key,
        itemId,
        kind: 'tool',
        title: method.includes('permissions')
          ? title('Codex permission request', 'Codex subagent {agent} permission request')
          : title('MCP input request', 'MCP input request (subagent {agent})'),
        toolName: string(params.serverName) || 'Codex',
        input: params.permissions ?? params,
        description: string(params.reason || params.message),
        alwaysScopes: [],
        ...(params.requestedSchema ? { formSchema: params.requestedSchema } : {}),
      }
    else {
      this.proc?.respondError(id, 'Unsupported client request')
      return
    }
    if (Array.isArray(params.availableDecisions)) {
      request.canAllow = params.availableDecisions.includes('accept')
      request.canDeny = params.availableDecisions.includes('decline')
      if (!params.availableDecisions.includes('acceptForSession')) request.alwaysScopes = []
    }
    this.approvals.set(key, { id, method, params, request })
    this.ctx.emit({ type: 'approval_request', request })
  }
  answer(id: string, decision: ApprovalDecision): void {
    const approval = this.approvals.get(id)
    if (!approval || !this.proc?.alive) {
      // 找不到审批或进程已退出：同样结束这张卡片，不留下点不动的审批
      this.approvals.delete(id)
      this.ctx.emit({ type: 'approval_resolved', requestId: id })
      return
    }
    const allow = decision.type === 'allow' || decision.type === 'allow_always'
    if (allow && approval.request.canAllow === false) return
    if (decision.type === 'allow_always' && !approval.request.alwaysScopes.includes(decision.scope)) return
    let response: unknown
    if (approval.method === 'item/tool/requestUserInput')
      response = {
        answers: Object.fromEntries(
          (approval.request.questions ?? []).map(q => [
            q.id!,
            { answers: decision.type === 'answer' ? [decision.answers[q.question] ?? ''] : [] },
          ]),
        ),
      }
    else if (approval.method === 'item/permissions/requestApproval')
      response = {
        permissions: allow ? approval.params.permissions : {},
        scope: decision.type === 'allow_always' ? 'session' : 'turn',
      }
    else if (approval.method === 'mcpServer/elicitation/request')
      response = {
        action: decision.type === 'form' || allow ? 'accept' : 'decline',
        content: decision.type === 'form' ? decision.content : null,
      }
    else
      response = {
        decision:
          decision.type === 'allow_always'
            ? 'acceptForSession'
            : allow
              ? 'accept'
              : approval.request.canDeny === false
                ? 'cancel'
                : 'decline',
      }
    this.proc.respond(approval.id, response)
    this.approvals.delete(id)
    this.ctx.emit({ type: 'approval_resolved', requestId: id })
  }
  private finish(outcome: TurnOutcome, error: string | null, detail: string | null = null): void {
    const active = this.active
    if (!active) return
    if (this.nativeTurnId) this.markFinished(this.nativeTurnId)
    this.active = null
    if (this.compacting) {
      this.compacting = false
      this.ctx.emit({
        type: 'context',
        context: {
          model: active.model,
          used: this.last.total || null,
          window: this.contextWindow,
          input: null,
          cacheRead: null,
          cacheWrite: null,
          output: null,
          observedAt: Date.now(),
          source: 'request',
          stale: true,
          compacting: false,
          diagnostic: null,
          diagnosticStale: true,
        },
      })
    }
    if (outcome === 'failed' && error && error !== this.reportedError)
      this.ctx.emit({
        type: 'item_completed',
        item: { kind: 'notice', id: 'cx-error-' + active.id, level: 'error', text: error, detail },
      })
    this.translator.finish(outcome === 'completed' ? 'completed' : outcome === 'interrupted' ? 'interrupted' : 'failed')
    for (const id of this.approvals.keys()) this.ctx.emit({ type: 'approval_resolved', requestId: id })
    this.approvals.clear()
    for (const id of this.guidance.keys())
      this.ctx.emit({ type: 'input_ack', id, state: 'uncertain', mode: 'guidance' })
    this.guidance.clear()
    this.earlyConsumed.clear()
    const difference = (key: 'input' | 'cacheRead' | 'cacheWrite' | 'output'): number =>
      Math.max(0, this.totals[key] - active.baseline[key])
    this.ctx.emit({
      type: 'turn_completed',
      turnId: active.id,
      outcome,
      error,
      usage: {
        durationMs: Date.now() - active.started,
        models: {
          [active.model || 'Codex']: {
            input: difference('input'),
            cacheRead: difference('cacheRead'),
            cacheWrite: difference('cacheWrite'),
            output: difference('output'),
            costUsd: null,
          },
        },
      },
    })
    this.nativeTurnId = null
    const waiters = this.turnWaiters
    this.turnWaiters = []
    for (const w of waiters) w()
  }
  private markFinished(turnId: string): void {
    this.finishedTurns.add(turnId)
    if (this.finishedTurns.size > 200) this.finishedTurns.delete(this.finishedTurns.values().next().value!)
  }
  /** 等待当前轮次结束（turn/completed 或本地 finish），超时返回 false */
  private waitTurnEnd(timeoutMs: number): Promise<boolean> {
    if (!this.active) return Promise.resolve(true)
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.turnWaiters = this.turnWaiters.filter(w => w !== done)
        resolve(false)
      }, timeoutMs)
      const done = (): void => {
        clearTimeout(timer)
        resolve(true)
      }
      this.turnWaiters.push(done)
    })
  }
  async interrupt(): Promise<void> {
    if (this.opening) await this.opening.catch(() => {})
    if (!this.active) return
    if (!this.nativeTurnId) {
      // turn/start 还没返回：本地先结束，返回后 run() 会补发 turn/interrupt
      this.finish('interrupted', null)
      return
    }
    try {
      await this.proc?.request('turn/interrupt', { threadId: this.threadId, turnId: this.nativeTurnId })
    } catch {
      // 中断请求本身失败：不再等待，直接结束进程，下次发消息时恢复
      this.proc?.kill()
      this.finish('interrupted', null)
      return
    }
    // 和 Claude 一致：等原生结束轮次（turn/completed）最多 5 秒，超时才强制结束进程
    if (this.active && !(await this.waitTurnEnd(5_000))) {
      this.proc?.kill()
      this.finish('interrupted', null)
    }
  }
  async close(opts: CloseOptions = {}): Promise<void> {
    this.closed = true
    await this.interrupt()
    await this.proc?.close(opts.quick ? QUICK_CLOSE_MS : undefined)
    this.ctx.extensions?.dispose?.()
  }
}
