import { delimiter } from 'node:path'
import type { ApprovalDecision, ApprovalRequest, EngineCatalog, ImageAttachment, SessionSettings, SkillCommand, TurnOutcome } from '@pixelsky/protocol'
import { EMPTY_FLAGS } from '@pixelsky/protocol'
import type { EngineSession, Launcher, SessionContext } from '../adapter'
import { CodexProcess, array, object, string, type Message } from './process'
import { codexCatalog } from './catalog'
import { codexChanges, CodexTranslator, tokenCounts } from './translate'

export interface CodexLaunchOptions { askQuestions: boolean; steeringValidated?: boolean; }
/** Codex TurnError 里 message 之外的原始信息（附加说明、错误类型、HTTP 状态码），给界面「详情」用；没有时为 null */
export function turnErrorDetail(raw: unknown, willRetry?: unknown): string | null {
  const error = object(raw), lines: string[] = []
  const details = string(error.additionalDetails).trim()
  if (details) lines.push(details)
  const info = error.codexErrorInfo
  if (typeof info === 'string' && info) lines.push(`type: ${info}`)
  else if (info && typeof info === 'object') for (const [kind, value] of Object.entries(info as Record<string, unknown>)) {
    lines.push(`type: ${kind}`)
    const status = object(value).httpStatusCode
    if (typeof status === 'number') lines.push(`HTTP status: ${status}`)
  }
  if (!lines.length) return null
  if (typeof willRetry === 'boolean') lines.push(`will retry: ${willRetry ? 'yes' : 'no'}`)
  return lines.join('\n')
}

export function codexPermission(mode: string, cwd?: string): Message {
  return mode === 'full' ? { approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } }
    : mode === 'plan' ? { approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly', networkAccess: false } }
    : { approvalPolicy: mode === 'ask' ? 'untrusted' : 'on-request', sandboxPolicy: { type: 'workspaceWrite', writableRoots: cwd ? [cwd] : [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }
}
type Approval = { id: string | number; method: string; params: Message; request: ApprovalRequest }
export function tomlValue(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(tomlValue).join(', ') + ']'
  if (value && typeof value === 'object') return '{ ' + Object.entries(value).filter(([,v])=>v!==undefined&&v!==null).map(([key,v])=>JSON.stringify(key)+' = '+tomlValue(v)).join(', ') + ' }'
  return JSON.stringify(value)
}
export class CodexSession implements EngineSession {
  private proc: CodexProcess | null = null
  private opening: Promise<void> | null = null
  private closed = false
  private threadId: string | null = null
  private nativeTurnId: string | null = null
  private readonly finishedTurns = new Set<string>()
  private active: { id: string; started: number; model: string; baseline: ReturnType<typeof tokenCounts>; usageSeen: boolean; activity: boolean } | null = null
  private settings: SessionSettings
  private catalog: EngineCatalog | null = null
  private readonly approvals = new Map<string, Approval>()
  private readonly guidance = new Map<string, { text: string; attachments: ImageAttachment[]; accepted: boolean; observed: boolean }>()
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

  constructor(private readonly launcher: Launcher, private readonly env: NodeJS.ProcessEnv, private readonly ctx: SessionContext, private readonly options: CodexLaunchOptions) {
    this.settings = { ...ctx.record() }; this.translator = new CodexTranslator(event => this.ctx.emit(event))
  }
  private async open(): Promise<void> {
    if (this.closed) throw new Error('Codex session is closed')
    if (this.threadId && this.proc?.alive) return
    if (this.opening) return this.opening
    this.opening = this.connect().finally(() => { this.opening = null })
    return this.opening
  }
  private async connect(): Promise<void> {
    const record = this.ctx.record(), environment = { ...this.env }, args = ['app-server', '--listen', 'stdio://']
    const config = (key: string, value: unknown): void => { args.push('-c', `${key}=${tomlValue(value)}`) }
    if (record.platform) {
      const base = environment.PIXELSKY_CODEX_BASE_URL
      if (!base || !environment.PIXELSKY_CODEX_TOKEN) throw new Error('Codex platform gateway is unavailable')
      config('model_provider', 'pixelsky'); config('model_providers.pixelsky.name', 'Pixel Starry Sky')
      config('model_providers.pixelsky.base_url', base); config('model_providers.pixelsky.wire_api', 'responses')
      config('model_providers.pixelsky.env_key', 'PIXELSKY_CODEX_TOKEN'); config('model_providers.pixelsky.requires_openai_auth', false)
      config('model_providers.pixelsky.supports_websockets', false)
    }
    if (this.ctx.maxRetries !== null && this.ctx.maxRetries !== undefined) {
      const provider = record.platform ? 'pixelsky' : string(environment.PIXELSKY_CODEX_PROVIDER)
      // 两层同时使用 N 会放大为 (N+1)² 次请求。自定义仅控制 HTTP
      // 请求层，禁用整条流重新发起；null 保留原生两层策略。
      if (provider) { config(`model_providers.${provider}.request_max_retries`, this.ctx.maxRetries); config(`model_providers.${provider}.stream_max_retries`, 0) }
    }
    if (this.ctx.extensions?.pathDirs.length) {
      const key = Object.keys(environment).find(k => k.toLowerCase() === 'path') ?? 'PATH'
      environment[key] = [...this.ctx.extensions.pathDirs, environment[key] ?? ''].join(delimiter)
    }
    const ext = this.ctx.extensions
    for (const [key, value] of Object.entries(ext?.codexConfig ?? {})) config(key, value)
    const proc = new CodexProcess(this.launcher, args, record.cwd, environment, {
      notification: (method, params) => this.notification(method, params), request: (id, method, params) => this.request(id, method, params),
      exit: (_code, tail) => { if (this.proc !== proc) return; if (!this.closed && this.active) this.finish('failed', tail || 'Codex process exited'); this.threadId = null },
    })
    this.proc = proc
    try {
      // 额外技能根是本机版本的实验字段，仅加载管理 Skills 时协商。
      await proc.initialize(!!ext?.skillRoots?.length)
      if (ext?.skillRoots?.length) await proc.request('skills/extraRoots/set', { extraRoots: ext.skillRoots })
      this.catalog = await codexCatalog(proc)
      const requirements = await proc.request('configRequirements/read').catch(() => ({}))
      const allowed = array(object(object(requirements).requirements).allowedApprovalPolicies)
      const policy = codexPermission(this.settings.permissionMode)
      if (allowed.length && !allowed.includes(policy.approvalPolicy)) throw new Error('Codex managed requirements prohibit this permission mode')
      const thread = await proc.request(record.engineSessionId ? 'thread/resume' : 'thread/start', {
        ...(record.engineSessionId ? { threadId: record.engineSessionId } : {}), cwd: record.cwd,
        ...(record.model ? { model: record.model } : {}), approvalPolicy: policy.approvalPolicy,
        sandbox: this.settings.permissionMode === 'full' ? 'danger-full-access' : this.settings.permissionMode === 'plan' ? 'read-only' : 'workspace-write',
      })
      this.threadId = string(object(thread.thread).id)
      if (!this.threadId) throw new Error('Codex did not return a thread ID')
      this.ctx.setEngineSessionId(this.threadId)
      this.ctx.emit({ type: 'flags', flags: { ...EMPTY_FLAGS, compactAvailable: true, contextAvailable: false, steerAvailable: this.options.steeringValidated === true, fastAvailable: false, fastState: 'off', fastBlocked: 'Codex provider fast mode is not verified', ultracodeAvailable: false } })
      if (this.settings.fast) { this.settings.fast = false; this.ctx.setFast(false) }
      const skills = await proc.request('skills/list', { cwds: [record.cwd], forceReload: !!ext?.skillRoots?.length, ...(ext?.skillRoots?.length ? { perCwdExtraUserRoots: { [record.cwd]: ext.skillRoots } } : {}) }).catch(() => ({}))
      this.skills = array(object(skills).data).flatMap(raw => array(object(raw).skills)).flatMap(raw => { const skill = object(raw); return skill.enabled === false || !string(skill.name) || !string(skill.path) ? [] : [{ name: string(skill.name), description: string(skill.description), source: 'engine' as const, invocation: 'skill' as const, path: string(skill.path) }] })
      this.ctx.emit({ type: 'commands', commands: [{ name: 'compact', description: 'Summarize the conversation to free up context', source: 'engine', builtin: true, invocation: 'slash' }, ...this.skills] })
    } catch (error) { this.proc = null; await proc.close(); throw error }
  }
  private input(text: string, attachments: ImageAttachment[]): Message[] {
    const input: Message[] = text ? [{ type: 'text', text, text_elements: [] }] : []
    for (const image of attachments) input.push({ type: 'image', url: `data:${image.mediaType};base64,${image.dataBase64}` })
    const match = /^\$([^\s]+)(?:\s|$)/.exec(text)
    const skill = this.skills.find(s => s.name === match?.[1])
    if (skill?.path) input.push({ type: 'skill', name: skill.name, path: skill.path })
    return input
  }
  send(text: string, turnId: string, userItemId: string, attachments: ImageAttachment[] = []): void {
    if (this.active) { this.ctx.emit({ type: 'turn_completed', turnId, outcome: 'failed', error: 'Codex turn already running' }); return }
    this.active = { id: turnId, started: Date.now(), model: this.settings.model ?? this.catalog?.currentModel ?? '', baseline: { ...this.totals }, usageSeen: false, activity: false }
    this.translator = new CodexTranslator(event => this.ctx.emit(event)); this.nativeTurnId = null
    this.reportedError = null
    const active = this.active
    void this.run(text, userItemId, attachments).catch(error => { if(this.active===active)this.finish('failed', (error as Error).message) })
  }
  private async run(text: string, userItemId: string, attachments: ImageAttachment[]): Promise<void> {
    const active = this.active
    await this.open()
    if (!this.active || this.active!==active || this.closed) return
    const selected = this.catalog?.models?.find(m => m.id === (this.settings.model ?? this.catalog?.currentModel))
    this.active.baseline = { ...this.totals }
    if (attachments.length && (!selected || !selected.inputModalities.includes('image'))) throw new Error('This Codex model does not support images')
    if (this.settings.effort && selected && !selected.efforts.includes(this.settings.effort)) throw new Error('This Codex model does not support the selected effort')
    this.active.model = this.settings.model ?? this.catalog?.currentModel ?? 'Codex'
    if (text === '/compact') {
      this.compacting = true
      this.ctx.emit({ type: 'context', context: { model: this.active.model, used: this.last.total || null, window: null, input: null, cacheRead: null, cacheWrite: null, output: null, observedAt: Date.now(), source: 'request', stale: true, compacting: true, diagnostic: null, diagnosticStale: true } })
      await this.proc!.request('thread/compact/start', { threadId: this.threadId })
    } else {
      const result = await this.proc!.request('turn/start', { threadId: this.threadId, clientUserMessageId: userItemId, input: this.input(text, attachments),
        ...codexPermission(this.settings.permissionMode, this.ctx.record().cwd), ...(this.settings.model ? { model: this.settings.model } : {}),
        ...(this.settings.effort ? { effort: this.settings.effort } : {}), summary: this.settings.thinkingSummaries ? 'concise' : 'none',
      })
      if (this.active===active) this.nativeTurnId = string(object(result.turn).id) || this.nativeTurnId
      this.ctx.emit({ type: 'input_ack', id: userItemId, state: 'consumed', mode: 'normal' })
    }
  }
  async update(patch: Partial<SessionSettings>): Promise<void> { if (!this.active) this.settings = { ...this.settings, ...patch }; }
  async steer(text: string, id: string, attachments: ImageAttachment[] = []): Promise<void> {
    if (!this.active || !this.nativeTurnId || !this.options.steeringValidated) throw new Error('Codex active turn cannot accept guidance')
    this.guidance.set(id, { text, attachments, accepted: false, observed: false })
    try {
      const result = await this.proc!.request('turn/steer', { threadId: this.threadId, expectedTurnId: this.nativeTurnId, clientUserMessageId: id, input: this.input(text, attachments) })
      if (string(result.turnId) !== this.nativeTurnId && this.active) throw new Error('Codex guidance turn mismatch')
      const pending = this.guidance.get(id)
      if (pending) { pending.accepted = true; if (pending.observed) this.consume(id) }
    } catch (error) { this.guidance.delete(id); throw error }
  }
  private consume(id: string): void { if (this.guidance.delete(id)) this.ctx.emit({ type: 'input_ack', id, state: 'consumed', mode: 'guidance' }) }
  private notification(method: string, params: Message): void {
    const eventThread = string(params.threadId)
    if (eventThread && this.threadId && eventThread !== this.threadId) return
    if (method === 'serverRequest/resolved') { const id = String(params.requestId); if (this.approvals.delete(id)) this.ctx.emit({ type: 'approval_resolved', requestId: id }); return }
    if (!this.active) return
    const eventTurn = string(params.turnId || object(params.turn).id)
    if (eventTurn && this.finishedTurns.has(eventTurn)) return
    if (eventTurn && this.nativeTurnId && eventTurn !== this.nativeTurnId) return
    if (method === 'turn/started') this.nativeTurnId = string(object(params.turn).id)
    else if (method === 'turn/completed') { const turn = object(params.turn); this.finish(turn.status === 'interrupted' ? 'interrupted' : turn.status === 'failed' ? 'failed' : 'completed', string(object(turn.error).message) || null, turnErrorDetail(turn.error)) }
    else if (method === 'item/started' || method === 'item/completed') {
      const item = object(params.item)
      if (item.type === 'userMessage') { const id = string(item.clientId || item.clientUserMessageId), pending = this.guidance.get(id); if (pending) { pending.observed = true; if (pending.accepted) this.consume(id) } }
      else { this.active.activity = true; this.translator.item(item, method === 'item/completed') }
    } else if (/^item\/(agentMessage|plan)\/delta$|^item\/reasoning\/summaryTextDelta$|^item\/commandExecution\/outputDelta$/.test(method)) this.translator.delta(method, params)
    else if (method === 'turn/plan/updated') this.translator.plan(params)
    else if (method === 'thread/tokenUsage/updated') {
      const usage = object(params.tokenUsage); this.totals = tokenCounts(usage.total); this.last = tokenCounts(usage.last)
      if (!this.active.activity) { this.active.baseline = { ...this.totals }; this.active.usageSeen = true }
      else if (!this.active.usageSeen) {
        for (const key of ['input','cacheRead','cacheWrite','output','total'] as const) this.active.baseline[key] = Math.max(0, this.totals[key] - this.last[key])
        this.active.usageSeen = true
      }
      const window = typeof usage.modelContextWindow === 'number' ? usage.modelContextWindow : null
      this.contextWindow = window
      this.ctx.emit({ type: 'usage', usage: { inputTokens: this.totals.input, outputTokens: this.totals.output, cacheReadTokens: this.totals.cacheRead, cacheWriteTokens: this.totals.cacheWrite, contextTokens: this.last.total, contextWindow: window, costUsd: null } })
      this.ctx.emit({ type: 'context', context: { model: this.active.model, used: this.last.total, window, input: this.last.input, cacheRead: this.last.cacheRead, cacheWrite: this.last.cacheWrite, output: this.last.output, observedAt: Date.now(), source: 'request', stale: false, compacting: false, diagnostic: null, diagnosticStale: true } })
    } else if (method === 'error' || method === 'warning') { const text=string(object(params.error).message || params.message);if(method==='error')this.reportedError=text;this.ctx.emit({ type: 'item_completed', item: { kind: 'notice', id: `cx-${method}-${Date.now()}-${++this.noticeSeq}`, level: method === 'error' ? 'error' : 'warn', text, detail: turnErrorDetail(params.error, params.willRetry) } }) }
  }
  private request(id: string | number, method: string, params: Message): void {
    if (!this.active || (params.threadId && params.threadId !== this.threadId) || (params.turnId && this.nativeTurnId && params.turnId !== this.nativeTurnId)) { this.proc?.respondError(id, 'No matching active turn'); return }
    const key = String(id), itemId = params.itemId ? 'cx-' + string(params.itemId) : null
    let request: ApprovalRequest
    if (method === 'item/commandExecution/requestApproval') request = { requestId: key, itemId, kind: 'command', title: params.networkApprovalContext ? 'Codex network access' : 'Codex command approval', command: string(params.command), description: string(params.reason), input: params.networkApprovalContext, alwaysScopes: ['session'] }
    else if (method === 'item/fileChange/requestApproval') request = { requestId: key, itemId, kind: 'file_change', title: 'Codex file changes', changes: codexChanges(params.changes ?? (itemId && object(this.translator.items.get(itemId)).changes)), description: string(params.reason), alwaysScopes: ['session'] }
    else if (method === 'item/tool/requestUserInput') {
      if (!this.options.askQuestions) { this.proc?.respond(id, { answers: {} }); return }
      request = { requestId: key, itemId, kind: 'question', title: 'Codex question', questions: array(params.questions).map(raw => { const question = object(raw); return { id: string(question.id), question: string(question.question), header: string(question.header), multiSelect: false, allowOther: question.isOther === true, secret: question.isSecret === true, options: array(question.options).map(o => ({ label: string(object(o).label), description: string(object(o).description) })) } }), alwaysScopes: [] }
    } else if (method === 'item/permissions/requestApproval' || method === 'mcpServer/elicitation/request') request = { requestId: key, itemId, kind: 'tool', title: method.includes('permissions') ? 'Codex permission request' : 'MCP input request', toolName: string(params.serverName) || 'Codex', input: params.permissions ?? params, description: string(params.reason || params.message), alwaysScopes: [], ...(params.requestedSchema ? { formSchema: params.requestedSchema } : {}) }
    else { this.proc?.respondError(id, 'Unsupported client request'); return }
    if (Array.isArray(params.availableDecisions)) {
      request.canAllow = params.availableDecisions.includes('accept')
      request.canDeny = params.availableDecisions.includes('decline')
      if (!params.availableDecisions.includes('acceptForSession')) request.alwaysScopes = []
    }
    this.approvals.set(key, { id, method, params, request }); this.ctx.emit({ type: 'approval_request', request })
  }
  answer(id: string, decision: ApprovalDecision): void {
    const approval = this.approvals.get(id)
    if (!approval || !this.proc?.alive) return
    const allow = decision.type === 'allow' || decision.type === 'allow_always'
    if(allow&&approval.request.canAllow===false)return
    if(decision.type==='allow_always'&&!approval.request.alwaysScopes.includes(decision.scope))return
    let response: unknown
    if (approval.method === 'item/tool/requestUserInput') response = { answers: Object.fromEntries((approval.request.questions ?? []).map(q => [q.id!, { answers: decision.type === 'answer' ? [decision.answers[q.question] ?? ''] : [] }])) }
    else if (approval.method === 'item/permissions/requestApproval') response = { permissions: allow ? approval.params.permissions : {}, scope: decision.type === 'allow_always' ? 'session' : 'turn' }
    else if (approval.method === 'mcpServer/elicitation/request') response = { action: decision.type === 'form' || allow ? 'accept' : 'decline', content: decision.type === 'form' ? decision.content : null }
    else response = { decision: decision.type === 'allow_always' ? 'acceptForSession' : allow ? 'accept' : approval.request.canDeny===false ? 'cancel' : 'decline' }
    this.proc.respond(approval.id, response); this.approvals.delete(id); this.ctx.emit({ type: 'approval_resolved', requestId: id })
  }
  private finish(outcome: TurnOutcome, error: string | null, detail: string | null = null): void {
    const active = this.active
    if (!active) return
    if(this.nativeTurnId){this.finishedTurns.add(this.nativeTurnId);if(this.finishedTurns.size>200)this.finishedTurns.delete(this.finishedTurns.values().next().value!)}
    this.active = null
    if(this.compacting){this.compacting=false;this.ctx.emit({type:'context',context:{model:active.model,used:this.last.total||null,window:this.contextWindow,input:null,cacheRead:null,cacheWrite:null,output:null,observedAt:Date.now(),source:'request',stale:true,compacting:false,diagnostic:null,diagnosticStale:true}})}
    if (outcome === 'failed' && error && error!==this.reportedError) this.ctx.emit({ type: 'item_completed', item: { kind: 'notice', id: 'cx-error-' + active.id, level: 'error', text: error, detail } })
    this.translator.finish(outcome === 'completed' ? 'completed' : outcome === 'interrupted' ? 'interrupted' : 'failed')
    for (const id of this.approvals.keys()) this.ctx.emit({ type: 'approval_resolved', requestId: id })
    this.approvals.clear()
    for (const id of this.guidance.keys()) this.ctx.emit({ type: 'input_ack', id, state: 'uncertain', mode: 'guidance' })
    this.guidance.clear(); this.earlyConsumed.clear()
    const difference = (key: 'input' | 'cacheRead' | 'cacheWrite' | 'output'): number => Math.max(0, this.totals[key] - active.baseline[key])
    this.ctx.emit({ type: 'turn_completed', turnId: active.id, outcome, error, usage: { durationMs: Date.now() - active.started, models: { [active.model || 'Codex']: { input: difference('input'), cacheRead: difference('cacheRead'), cacheWrite: difference('cacheWrite'), output: difference('output'), costUsd: null } } } })
    this.nativeTurnId = null
  }
  async interrupt(): Promise<void> {
    if (this.opening) await this.opening.catch(() => {})
    if (!this.active) return
    if (!this.nativeTurnId) { this.finish('interrupted', null); return }
    try { await this.proc?.request('turn/interrupt', { threadId: this.threadId, turnId: this.nativeTurnId }) }
    catch { this.proc?.kill() }
    if (this.active) {
      await new Promise(resolve => setTimeout(resolve, 300))
      if (this.active) { this.proc?.kill(); this.finish('interrupted', null) }
    }
  }
  async stopTask(): Promise<void> { throw new Error('Codex background terminal management is not enabled') }
  async taskOutput(): Promise<never> { throw new Error('Codex background terminal management is not enabled') }
  async close(): Promise<void> { this.closed = true; await this.interrupt(); await this.proc?.close(); this.ctx.extensions?.dispose?.() }
}
