// 像素星空会话：一个会话一个 `pixelsky --mode rpc` 子进程（docs/own-cli.md §4.1）
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import type {
  ApprovalDecision,
  ApprovalRequest,
  ImageAttachment,
  PermissionMode,
  SessionSettings,
  SkillCommand,
  TurnOutcome,
} from '@pixelsky/protocol'
import { EMPTY_FLAGS } from '@pixelsky/protocol'
import { QUICK_CLOSE_MS, type CloseOptions, type EngineSession, type Launcher, type SessionContext } from '../adapter'
import { findModel, piThinkingLevel } from './catalog'
import { PixelProcess, array, object, string, type Message } from './process'
import { PixelTranslator, approvalFor, toolNameFromTitle } from './translate'

/** 批准扩展里运行中切换权限模式的命令（packages/cli/src/extensions/approval.ts 的 MODE_COMMAND） */
const MODE_COMMAND = 'pixelsky-mode'

/** 我们的权限模式 → 批准扩展的 --permission-mode */
export const PIXEL_MODES: Record<PermissionMode, string> = {
  ask: 'default',
  edits: 'acceptEdits',
  plan: 'plan',
  full: 'bypassPermissions',
}

/** 平台 / 自定义 API 会话经本机网关：宿主（sessionEnv）给的环境变量，写进每个会话自己的 models.json（不含密钥） */
export const GATEWAY_ENV = {
  baseUrl: 'PIXELSKY_PIXEL_BASE_URL',
  /** 会话密钥：只放环境变量，models.json 里写 $PIXELSKY_PIXEL_TOKEN 让 Pi 自己展开 */
  token: 'PIXELSKY_PIXEL_TOKEN',
  /** anthropic-messages（默认）/ openai-responses / openai-completions */
  api: 'PIXELSKY_PIXEL_API',
  /** 可选：JSON 数组，元素是模型 id 或完整的 models.json 模型定义；不给就只有会话选的那个模型 */
  models: 'PIXELSKY_PIXEL_MODELS',
} as const
export const GATEWAY_PROVIDER = 'pixelsky'

export interface PixelLaunchOptions {
  /** 用户追加的启动参数 */
  args?: string[]
  /** 网关会话的临时配置目录放哪（默认系统临时目录下的 pixelsky-pixel） */
  agentRoot?: string
}

/** 用户追加的参数里第一个由像素星空控制的；都允许时返回 null */
export function reservedPixelArg(args: readonly string[]): string | null {
  for (const arg of args) {
    for (const name of [
      '--mode',
      '--permission-mode',
      '--session-dir',
      '--no-session',
      '--session',
      '--continue',
      '--resume',
    ])
      if (arg === name || arg.startsWith(name + '=')) return name
  }
  return null
}

/** Pi 的会话目录：和终端里用 pixelsky 时一样（网关会话用临时配置目录，会话文件仍然放这里，才不会随临时目录删掉） */
export function pixelSessionsDir(env: NodeJS.ProcessEnv): string {
  return join(env.PIXELSKY_CODING_AGENT_DIR?.trim() || join(homedir(), '.pixelsky-cli', 'agent'), 'sessions')
}

/**
 * 需要自定义地址时生成 models.json 的内容；不需要返回 null。
 * - 网关会话（PIXELSKY_PIXEL_BASE_URL）：自定义 provider "pixelsky"，密钥用 $PIXELSKY_PIXEL_TOKEN
 * - 用户自己配了 ANTHROPIC_BASE_URL / OPENAI_BASE_URL（Pi 不认这两个环境变量）：覆盖内置 provider 的 baseUrl，密钥照常用 ANTHROPIC_API_KEY / OPENAI_API_KEY
 */
export function pixelModelsConfig(env: NodeJS.ProcessEnv, model: string | null): Message | null {
  const providers: Message = {}
  const base = env[GATEWAY_ENV.baseUrl]?.trim()
  if (base) {
    const api = env[GATEWAY_ENV.api]?.trim() || 'anthropic-messages'
    let models: unknown[] = []
    try {
      models = array(JSON.parse(env[GATEWAY_ENV.models] ?? '[]'))
    } catch {
      models = []
    }
    const id = model?.replace(new RegExp(`^${GATEWAY_PROVIDER}/`), '') ?? ''
    const defs = models.map(m => (typeof m === 'string' ? { id: m } : object(m))).filter(m => string(m.id))
    if (id && !defs.some(m => string(m.id) === id)) defs.push({ id })
    providers[GATEWAY_PROVIDER] = {
      baseUrl: base,
      api,
      apiKey: `$${GATEWAY_ENV.token}`,
      models: defs.map(m => ({
        reasoning: api !== 'openai-completions',
        input: ['text', 'image'],
        ...m,
      })),
    }
  } else {
    if (env.ANTHROPIC_BASE_URL?.trim()) providers.anthropic = { baseUrl: env.ANTHROPIC_BASE_URL.trim() }
    if (env.OPENAI_BASE_URL?.trim()) providers.openai = { baseUrl: env.OPENAI_BASE_URL.trim() }
  }
  return Object.keys(providers).length ? { providers } : null
}

type Pending = {
  request: ApprovalRequest
  method: string
  options: string[]
  timer: NodeJS.Timeout | null
}

export class PixelSession implements EngineSession {
  private proc: PixelProcess | null = null
  private opening: Promise<void> | null = null
  private closed = false
  private ready = false
  private active: { id: string; started: number; promptSent: boolean } | null = null
  private settings: SessionSettings
  /** get_available_models 的原始结果（set_model 要 provider 和 modelId） */
  private models: Message[] = []
  private modelInfo: Message = {}
  private readonly approvals = new Map<string, Pending>()
  /** 已经挂到某张审批卡片上的工具条目（批准请求里没有 toolCallId，按工具名找最早的没挂过的） */
  private readonly linked = new Map<string, string>()
  /** 等 Pi 交付的引导消息（按发送顺序），交付时 Pi 会发一条用户消息 */
  private readonly guidance: string[] = []
  private promptUserSeen = false
  private translator: PixelTranslator
  private agentDir: string | null = null
  private turnWaiters: Array<() => void> = []

  constructor(
    private readonly launcher: Launcher,
    private readonly env: NodeJS.ProcessEnv,
    private readonly ctx: SessionContext,
    private readonly options: PixelLaunchOptions = {},
  ) {
    this.settings = { ...ctx.record() }
    this.translator = new PixelTranslator(event => this.ctx.emit(event), {
      cwd: ctx.record().cwd,
      userMessage: () => this.userMessage(),
      contextWindow: () => {
        const w = this.modelInfo.contextWindow
        return typeof w === 'number' && w > 0 ? w : null
      },
    })
  }

  private async open(): Promise<void> {
    if (this.closed) throw new Error('Pixel session is closed')
    if (this.ready && this.proc?.alive) return
    if (this.opening) return this.opening
    this.opening = this.connect().finally(() => {
      this.opening = null
    })
    return this.opening
  }

  private async connect(): Promise<void> {
    const record = this.ctx.record(),
      environment: NodeJS.ProcessEnv = { ...this.env },
      args = ['--mode', 'rpc', '--permission-mode', PIXEL_MODES[this.settings.permissionMode] ?? 'default']
    Object.assign(environment, this.ctx.extensions?.env)
    if (this.ctx.extensions?.pathDirs.length) {
      const key = Object.keys(environment).find(k => k.toLowerCase() === 'path') ?? 'PATH'
      environment[key] = [...this.ctx.extensions.pathDirs, environment[key] ?? ''].join(delimiter)
    }
    // 自定义地址：这个会话自己的临时配置目录里放 models.json；会话文件仍放在原来的会话目录
    const models = pixelModelsConfig(environment, record.model)
    if (models) {
      const root = this.options.agentRoot ?? join(tmpdir(), 'pixelsky-pixel')
      mkdirSync(root, { recursive: true })
      this.agentDir = mkdtempSync(join(root, 'agent-'))
      writeFileSync(join(this.agentDir, 'models.json'), JSON.stringify(models), { mode: 0o600 })
      args.push('--session-dir', pixelSessionsDir(environment))
      environment.PIXELSKY_CODING_AGENT_DIR = this.agentDir
    }
    args.push(...(this.options.args ?? []))
    const proc = new PixelProcess(this.launcher, args, record.cwd, environment, {
      event: event => this.event(event),
      exit: (_code, tail) => {
        if (this.proc !== proc) return
        this.ready = false
        this.rejectApprovals()
        if (!this.closed && this.active) this.finish('failed', tail.trim() || 'Pixel process exited')
      },
    })
    this.proc = proc
    try {
      let state = object((await proc.request('get_state')).data)
      // 续接：引擎会话 id 是会话文件路径
      const resume = record.engineSessionId
      if (resume && string(state.sessionFile) !== resume) {
        let resumed = false
        if (existsSync(resume))
          try {
            resumed = object((await proc.request('switch_session', { sessionPath: resume })).data).cancelled !== true
          } catch (error) {
            if (!proc.alive) throw error
          }
        if (!resumed)
          this.translator.notice(
            'warn',
            'Could not resume the Pixel session; started a new session (previous context was not carried over)',
          )
      }
      this.models = array((await proc.request('get_available_models')).data.models).map(object)
      if (record.model) {
        const model = findModel(this.models, record.model)
        if (!model) throw new Error(`Model not found: ${record.model}`)
        await proc.request('set_model', { provider: string(model.provider), modelId: string(model.id) })
      }
      if (this.settings.effort)
        await proc.request('set_thinking_level', { level: piThinkingLevel(this.settings.effort) })
      if (this.ctx.maxRetries === 0) await proc.request('set_auto_retry', { enabled: false })
      state = object((await proc.request('get_state')).data)
      this.modelInfo = object(state.model)
      this.ctx.setEngineSessionId(string(state.sessionFile) || string(state.sessionId))
      // 切回旧会话：用 Pi 记的累计作基线，用量不从零开始
      const stats = object(
        (await proc.request('get_session_stats').catch(() => ({ command: 'get_session_stats', data: {} as Message })))
          .data,
      )
      const tokens = object(stats.tokens)
      this.translator.totals = {
        input: Number(tokens.input) || 0,
        output: Number(tokens.output) || 0,
        cacheRead: Number(tokens.cacheRead) || 0,
        cacheWrite: Number(tokens.cacheWrite) || 0,
        cost: Number(stats.cost) || 0,
      }
      const used = object(stats.contextUsage).tokens
      this.translator.lastContext = typeof used === 'number' ? used : null
      if (this.translator.lastContext !== null) this.translator.emitUsage()
      this.ctx.emit({
        type: 'flags',
        flags: {
          ...EMPTY_FLAGS,
          compactAvailable: true,
          contextAvailable: false,
          steerAvailable: true,
          fastAvailable: false,
          fastState: 'off',
          fastBlocked: 'Fast mode is not supported',
          ultracodeAvailable: false,
        },
      })
      if (this.settings.fast) {
        this.settings.fast = false
        this.ctx.setFast(false)
      }
      await this.emitCommands(proc)
      this.ready = true
    } catch (error) {
      this.proc = null
      await proc.close()
      this.cleanupAgentDir()
      throw error
    }
  }

  private async emitCommands(proc: PixelProcess): Promise<void> {
    const found = await proc.request('get_commands').catch(() => ({ command: 'get_commands', data: {} as Message }))
    const commands: SkillCommand[] = [
      {
        name: 'compact',
        description: 'Summarize the conversation to free up context',
        source: 'engine',
        builtin: true,
        invocation: 'slash',
      },
    ]
    for (const raw of array(found.data.commands)) {
      const c = object(raw)
      const name = string(c.name)
      // 扩展命令是适配器自己用的（切换权限模式），技能和提示词模板才给用户
      if (!name || c.source === 'extension') continue
      commands.push({
        name,
        description: string(c.description),
        source: 'engine',
        invocation: c.source === 'skill' ? 'skill' : 'slash',
        ...(string(object(c.sourceInfo).path) ? { path: string(object(c.sourceInfo).path) } : {}),
      })
    }
    this.ctx.emit({ type: 'commands', commands })
  }

  private cleanupAgentDir(): void {
    if (!this.agentDir) return
    rmSync(this.agentDir, { recursive: true, force: true })
    this.agentDir = null
  }

  // ---------------------------------------------------------------------------
  // 发送
  // ---------------------------------------------------------------------------

  send(text: string, turnId: string, userItemId: string, attachments: ImageAttachment[] = []): void {
    if (this.active) {
      this.ctx.emit({ type: 'turn_completed', turnId, outcome: 'failed', error: 'Pixel turn already running' })
      return
    }
    const active = { id: turnId, started: Date.now(), promptSent: false }
    this.active = active
    this.promptUserSeen = false
    this.guidance.length = 0
    this.translator.beginTurn()
    void this.run(active, text, userItemId, attachments).catch(error => {
      if (this.active === active) this.finish('failed', (error as Error).message)
    })
  }

  private async run(
    active: NonNullable<PixelSession['active']>,
    text: string,
    userItemId: string,
    attachments: ImageAttachment[],
  ): Promise<void> {
    await this.open()
    if (this.active !== active || this.closed) return
    if (attachments.length && !array(this.modelInfo.input).includes('image'))
      throw new Error('This model does not support images')
    const proc = this.proc!
    const compact = /^\/compact(?:\s+([\s\S]*))?$/.exec(text.trim())
    active.promptSent = true
    if (compact) {
      // Pi 内置的 /compact 只在终端里有，RPC 里用 compact 命令；没有 agent_settled，回应就是结束
      const instructions = compact[1]?.trim()
      await proc.request('compact', instructions ? { customInstructions: instructions } : {}, 10 * 60_000)
      this.ctx.emit({ type: 'input_ack', id: userItemId, state: 'consumed', mode: 'normal' })
      if (this.active === active) this.finish('completed', null)
      return
    }
    const response = await proc.request(
      'prompt',
      {
        message: text,
        ...(attachments.length
          ? { images: attachments.map(i => ({ type: 'image', data: i.dataBase64, mimeType: i.mediaType })) }
          : {}),
      },
      60_000,
    )
    if (this.active !== active) return
    this.ctx.emit({ type: 'input_ack', id: userItemId, state: 'consumed', mode: 'normal' })
    // handled：被扩展命令或输入处理器吃掉，不会有这一轮的 agent_settled
    if (string(response.data.disposition) === 'handled') this.finish('completed', null)
  }

  async steer(text: string, id: string, attachments: ImageAttachment[] = []): Promise<void> {
    if (!this.active || !this.proc?.alive || !this.ready) throw new Error('Pixel active turn cannot accept guidance')
    if (attachments.length && !array(this.modelInfo.input).includes('image'))
      throw new Error('This model does not support images')
    this.guidance.push(id)
    try {
      const response = await this.proc.request('steer', {
        message: text,
        ...(attachments.length
          ? { images: attachments.map(i => ({ type: 'image', data: i.dataBase64, mimeType: i.mediaType })) }
          : {}),
      })
      // handled：输入处理器吃掉了，不会再有用户消息
      if (string(response.data.disposition) === 'handled') this.consume(id)
    } catch (error) {
      this.guidance.splice(this.guidance.indexOf(id), 1)
      throw error
    }
  }

  private consume(id: string): void {
    const index = this.guidance.indexOf(id)
    if (index >= 0) this.guidance.splice(index, 1)
    this.ctx.emit({ type: 'input_ack', id, state: 'consumed', mode: 'guidance' })
  }

  /** Pi 把一条用户消息放进上下文：这一轮的第一条是提示本身，之后的是交付了的引导 */
  private userMessage(): void {
    if (!this.promptUserSeen) {
      this.promptUserSeen = true
      return
    }
    const id = this.guidance.shift()
    if (id) this.ctx.emit({ type: 'input_ack', id, state: 'consumed', mode: 'guidance' })
  }

  // ---------------------------------------------------------------------------
  // 事件
  // ---------------------------------------------------------------------------

  private event(raw: Message): void {
    const type = string(raw.type)
    if (type === 'extension_ui_request') return this.uiRequest(raw)
    if (!this.active) return
    if (type === 'agent_settled') {
      if (raw.aborted === true) return this.finish('interrupted', null)
      const error = this.translator.takeError()
      return error ? this.finish('failed', error) : this.finish('completed', null)
    }
    if (type === 'auto_retry_start') {
      this.ctx.emit({
        type: 'request_retry',
        retry: {
          turnId: this.active.id,
          attempt: Number(raw.attempt) || null,
          maxRetries: Number(raw.maxAttempts) || null,
          retryAt: Date.now() + (Number(raw.delayMs) || 0),
          reason: string(raw.errorMessage),
        },
      })
      return
    }
    if (type === 'auto_retry_end') {
      this.ctx.emit({ type: 'request_retry', retry: null })
      if (raw.success === false)
        this.translator.notice('error', string(raw.finalError) || 'Request failed after retries')
      return
    }
    // queue_update 不转成 queue 事件：排队由宿主管理，引导的交付以用户消息为准（userMessage）
    this.translator.event(raw)
  }

  private uiRequest(raw: Message): void {
    const id = string(raw.id),
      method = string(raw.method)
    if (method === 'notify') {
      const level = raw.notifyType === 'error' ? 'error' : raw.notifyType === 'warning' ? 'warn' : 'info'
      const text = string(raw.message)
      if (text) this.translator.notice(level, text)
      return
    }
    if (method !== 'confirm' && method !== 'select' && method !== 'input' && method !== 'editor') return
    if (!this.active || !this.proc?.alive) {
      this.proc?.respondUi(id, { cancelled: true })
      return
    }
    const title = string(raw.title)
    let request: ApprovalRequest
    let options: string[] = []
    if (method === 'confirm') {
      const item = this.translator.runningTool(toolNameFromTitle(title), new Set(this.linked.values()))
      request = approvalFor(id, title, string(raw.message), item)
      if (item) this.linked.set(id, item.id)
    } else {
      options = array(raw.options).map(string)
      request = {
        requestId: id,
        itemId: null,
        kind: 'question',
        title,
        questions: [
          {
            question: title,
            header: '',
            multiSelect: false,
            allowOther: method !== 'select',
            secret: false,
            options: options.map(label => ({ label, description: '' })),
          },
        ],
        alwaysScopes: [],
      }
    }
    // 对话框自带超时（Pi 到时自己按取消处理）：卡片也跟着收掉
    const timeout = typeof raw.timeout === 'number' && raw.timeout > 0 ? raw.timeout : 0
    const timer = timeout ? setTimeout(() => this.dropApproval(id), timeout) : null
    timer?.unref()
    this.approvals.set(id, { request, method, options, timer })
    this.ctx.emit({ type: 'approval_request', request })
  }

  private dropApproval(id: string): void {
    const approval = this.approvals.get(id)
    if (!approval) return
    if (approval.timer) clearTimeout(approval.timer)
    this.approvals.delete(id)
    this.linked.delete(id)
    this.ctx.emit({ type: 'approval_resolved', requestId: id })
  }

  /** 把所有等待中的审批按取消回给 Pi 并收掉卡片（停止、一轮结束、进程退出） */
  private rejectApprovals(): void {
    for (const id of [...this.approvals.keys()]) {
      this.proc?.respondUi(id, { cancelled: true })
      this.dropApproval(id)
    }
  }

  answer(requestId: string, decision: ApprovalDecision): void {
    if (decision.type === 'allow_all')
      throw new Error('This engine does not support enabling full access from an approval')
    const approval = this.approvals.get(requestId)
    if (!approval || !this.proc?.alive) {
      // 找不到审批或进程已退出：同样结束这张卡片，不留下点不动的审批
      this.dropApproval(requestId)
      return
    }
    const allow = decision.type === 'allow' || decision.type === 'allow_always'
    if (approval.method === 'confirm') {
      this.proc.respondUi(requestId, { confirmed: allow })
    } else if (approval.method === 'select') {
      const answers = decision.type === 'answer' ? Object.values(decision.answers) : []
      const value = answers[0] ?? (allow ? approval.options[0] : undefined)
      this.proc.respondUi(requestId, value !== undefined ? { value } : { cancelled: true })
    } else {
      const value = decision.type === 'answer' ? Object.values(decision.answers)[0] : undefined
      this.proc.respondUi(requestId, value !== undefined ? { value } : { cancelled: true })
    }
    this.dropApproval(requestId)
  }

  private finish(outcome: TurnOutcome, error: string | null): void {
    const active = this.active
    if (!active) return
    this.active = null
    if (outcome === 'failed' && error)
      this.ctx.emit({
        type: 'item_completed',
        item: { kind: 'notice', id: 'px-error-' + active.id, level: 'error', text: error, detail: null },
      })
    this.translator.finish(outcome === 'completed' ? 'completed' : outcome === 'interrupted' ? 'interrupted' : 'failed')
    this.rejectApprovals()
    this.ctx.emit({ type: 'request_retry', retry: null })
    for (const id of this.guidance) this.ctx.emit({ type: 'input_ack', id, state: 'uncertain', mode: 'guidance' })
    this.guidance.length = 0
    this.ctx.emit({
      type: 'turn_completed',
      turnId: active.id,
      outcome,
      error,
      usage: this.translator.turnUsage(Date.now() - active.started),
    })
    const waiters = this.turnWaiters
    this.turnWaiters = []
    for (const w of waiters) w()
  }

  /** 等当前一轮结束，超时返回 false */
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
    const active = this.active
    if (!active) return
    if (!active.promptSent || !this.proc?.alive) {
      // 提示还没发出去（进程在启动）：本地直接结束，run() 发现已结束就不发了
      this.finish('interrupted', null)
      return
    }
    // 等批准的对话框会让 abort 一直等：先全部按取消回掉
    this.rejectApprovals()
    try {
      await this.proc.request('abort', {}, 10_000)
    } catch {
      // 中断请求本身失败：不再等待，直接结束进程，下次发消息时恢复
      this.proc?.kill()
      this.finish('interrupted', null)
      return
    }
    // agent_settled(aborted) 通常紧跟其后；最多再等 5 秒，超时才强制结束进程
    if (this.active && !(await this.waitTurnEnd(5_000))) {
      this.proc?.kill()
      this.finish('interrupted', null)
    }
  }

  async update(patch: Partial<SessionSettings>, strict = false): Promise<void> {
    if (this.opening) await this.opening.catch(() => {})
    const before = this.settings
    this.settings = { ...before, ...patch }
    const proc = this.proc
    if (!proc?.alive || !this.ready) return
    try {
      if (patch.model !== undefined && patch.model !== before.model && patch.model) {
        const model = findModel(this.models, patch.model)
        if (!model) throw new Error(`Model not found: ${patch.model}`)
        const response = await proc.request('set_model', {
          provider: string(model.provider),
          modelId: string(model.id),
        })
        this.modelInfo = object(response.data)
        // 换模型后 Pi 会按新模型夹紧思考级别：重新套用选的强度
        if (this.settings.effort)
          await proc.request('set_thinking_level', { level: piThinkingLevel(this.settings.effort) })
      } else if (patch.effort !== undefined && patch.effort !== before.effort && patch.effort) {
        await proc.request('set_thinking_level', { level: piThinkingLevel(patch.effort) })
      }
      if (patch.permissionMode !== undefined && patch.permissionMode !== before.permissionMode) {
        // 批准扩展的命令：prompt 里以 / 开头的扩展命令立即执行，不进模型，回应 disposition 为 handled
        const response = await proc.request('prompt', {
          message: `/${MODE_COMMAND} ${PIXEL_MODES[patch.permissionMode]}`,
        })
        if (string(response.data.disposition) !== 'handled') throw new Error('Pixel did not switch the permission mode')
      }
    } catch (error) {
      // 没生效：退回原值，下一轮开始前（strict）报错；宽松调用只记设置
      this.settings = before
      if (strict) throw error
    }
  }

  async close(opts: CloseOptions = {}): Promise<void> {
    this.closed = true
    await this.interrupt()
    this.rejectApprovals()
    await this.proc?.close(opts.quick ? QUICK_CLOSE_MS : undefined)
    this.cleanupAgentDir()
    this.ctx.extensions?.dispose?.()
  }
}
