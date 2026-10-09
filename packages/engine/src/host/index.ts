// EngineHost：管理所有项目和会话（docs/engines.md §3、§8）
//
// - 会话的运行状态（idle / running / waiting）和会话记录由这里维护，适配器只发条目、审批、用量、一轮结束；
// - 每个会话的快照用 @pixelsky/protocol 的 reduce() 折叠，和界面用的是同一个函数；
// - 新会话发第一条消息时才启动引擎；一轮结束后空闲一段时间自动关掉进程，下次发消息时恢复；
// - 只保存完成的条目（item_completed），不保存流式增量。
import { randomUUID } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { statSync } from 'node:fs'
import { artifactQuery, collectArtifacts, historyItems, recordedIn } from '../artifacts'
import {
  AUTO_COMPACT_PCTS,
  EFFORTS,
  PERMISSION_MODES,
  emptySnapshot,
  normalizeSessionTitle,
  normalizeProjectName,
  reduce,
  type ApprovalDecision,
  type EngineCatalog,
  type EngineConfig,
  type EngineConfigPatch,
  type EngineDefaults,
  type EngineEvent,
  type EngineId,
  type EngineInfo,
  type EngineLocalConfig,
  type EngineUpdateResult,
  type HostEvent,
  type Item,
  type MessageInput,
  type QueuedMessage,
  type RewindResult,
  type SendReceipt,
  type OpenedSession,
  type TaskOutput,
  type ProjectRecord,
  type SessionDefaults,
  type SessionRecord,
  type SessionSettings,
  type SessionSnapshot,
  type SessionSummary,
  type QueueSummary,
  type TurnOutcome,
  type TurnUsage,
  type UsagePage,
  type UsageRecord,
  type UsageSummary,
} from '@pixelsky/protocol'
import type { EngineAdapter, EngineSession } from '../adapter'
import { ClaudeAdapter } from '../claude'
import { CodexAdapter } from '../codex'
import { ENGINES, ENGINE_ORDER, unsupportedInfo } from '../registry'
import { Store, type EngineSettingsFile } from '../store'
import { UsageStore, type UsageQuery } from '../usage'
import { CacheWatch } from '../cache-watch'
import { settleUsage } from '../billing'
import type { PlatformRequest, PlatformCharge, PlatformSettlement } from '@pixelsky/protocol'
import { retryLimit } from '../retry'
import { searchQuery, searchSessions } from '../search'
import { messageInput, queueSettings, sameQueueSettings } from '../queue'

export interface EngineHostOptions {
  platformCharges?: (settlement: PlatformSettlement, signal: AbortSignal) => Promise<PlatformCharge[]>
  settlementDelays?: number[]
  /** 按项目准备插件 / MCP 配置；返回的临时资源由引擎连接关闭时释放。 */
  extensions?: (record: SessionRecord) => import('@pixelsky/protocol').ExtensionLaunch
  /** 宿主为单个会话提供平台代理环境，空值使用本机认证。 */
  sessionEnv?: (record: SessionRecord) => NodeJS.ProcessEnv
  /** 保存数据的目录（Electron 里是 userData/engine） */
  dataDir: string
  /** 广播事件给界面 */
  emit(event: HostEvent): void
  /** 空闲多久关闭引擎进程，默认 30 分钟 */
  idleMs?: number
  /** 测试用：替换适配器 */
  adapters?: Partial<Record<EngineId, EngineAdapter>>
  /** 平台认证 / 路由预检；排队时只保存身份，执行前重新验证。 */
  validateInput?: (record: SessionRecord) => Promise<void>
}

interface Runtime {
  inspectingContext?: boolean
  sessionMaxRetries: number | null | undefined
  snapshot: SessionSnapshot
  /** 事件序号，每应用一个事件加一（见 OpenedSession） */
  seq: number
  session: EngineSession | null
  idleTimer: NodeJS.Timeout | null
  receipts: SendReceipt[]
  pumping: boolean
  stopping: boolean
  generation: number
  activeId: string | null
  execution: SessionRecord | null
  sessionSource: string | null | undefined
  /** 启动这个进程时的引擎级设置（launchKey）；设置变了，下一条消息前重启进程 */
  sessionLaunch?: string
  pumpFinished: Promise<void> | null
}

const NEW_TITLE = '新会话'
const TITLE_MAX = 30

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function titleFrom(text: string): string {
  const line = text.trim().split(/\r?\n/)[0].trim()
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX)}…` : line || NEW_TITLE
}

export class EngineHost {
  private readonly platformRequests = new Map<string, PlatformRequest[]>()
  private readonly settlements = new Map<string, AbortController>()
  private usageEpoch = 0

  /** Capture the execution before the gateway awaits I/O; late requests cannot move to a later turn. */
  platformRequestContext(record: SessionRecord): ((requestId: string, model: string) => void) | undefined {
    const rt = this.runtimes.get(record.id),
      turnId = rt?.snapshot.turnId
    if (!rt || !turnId || !record.platform) return
    const key = `${record.id}:${turnId}`,
      groupId = record.platform.groupId
    return (requestId, model) => {
      if (rt.snapshot.turnId !== turnId || this.closing) return
      const requests = this.platformRequests.get(key) ?? []
      requests.push({ id: requestId, model, groupId })
      this.platformRequests.set(key, requests)
    }
  }

  executionRecord(id: string): SessionRecord | null {
    return this.runtimes.get(id)?.execution ?? this.records.get(id) ?? null
  }
  private readonly cacheWatches = new Map<string, CacheWatch>()
  private readonly cacheAlertTurns = new Map<string, string>()
  private readonly store: Store
  private readonly usage: UsageStore
  private readonly adapters: Partial<Record<EngineId, EngineAdapter>>
  private readonly idleMs: number
  private projectList: ProjectRecord[] = []
  private records = new Map<string, SessionRecord>()
  private runtimes = new Map<string, Runtime>()
  private settings: EngineSettingsFile
  private closing = false
  private readonly changingSessions = new Set<string>()
  private readonly lockedWorkspaces = new Set<string>()
  private workspaceKey(path: string): string {
    const key = resolve(path)
    return process.platform === 'win32' ? key.toLowerCase() : key
  }
  async withWorkspaceStopped<T>(path: string, action: () => Promise<T>): Promise<T> {
    const key = this.workspaceKey(path)
    if (this.lockedWorkspaces.has(key)) throw new Error('工作目录正在维护，请稍后重试')
    this.lockedWorkspaces.add(key)
    try {
      for (const record of this.records.values()) {
        if (this.workspaceKey(record.cwd) !== key) continue
        const rt = this.runtime(record.id)
        await this.interrupt(record.id)
        await rt.pumpFinished
        rt.generation++
        if (rt.idleTimer) clearTimeout(rt.idleTimer)
        await rt.session?.close()
        rt.session = null
        if (rt.snapshot.turnId)
          this.onEngineEvent(record.id, {
            type: 'turn_completed',
            turnId: rt.snapshot.turnId,
            outcome: 'interrupted',
            error: null,
          })
        if (rt.snapshot.state !== 'idle') this.apply(record.id, { type: 'status', state: 'idle' })
      }
      return await action()
    } finally {
      this.lockedWorkspaces.delete(key)
    }
  }

  constructor(private readonly opts: EngineHostOptions) {
    this.store = new Store(opts.dataDir)
    this.usage = new UsageStore(opts.dataDir)
    this.usage.prune()
    this.settings = this.store.loadSettings()
    this.idleMs = opts.idleMs ?? 30 * 60_000
    this.adapters = opts.adapters ?? {
      claude: new ClaudeAdapter({
        overridePath: () => this.settings.paths.claude ?? null,
        extraEnv: () => this.settings.env.claude ?? {},
        launchOptions: () => this.launchOptions('claude'),
        sessionEnv: opts.sessionEnv,
      }),
      codex: new CodexAdapter({
        overridePath: () => this.settings.paths.codex ?? null,
        extraEnv: () => this.settings.env.codex ?? {},
        sessionEnv: opts.sessionEnv,
        launchOptions: () => ({ askQuestions: this.launchOptions('codex').askQuestions, steeringValidated: true }),
      }),
    }
    this.projectList = this.store.loadProjects()
    for (const r of this.store.loadRecords()) this.records.set(r.id, r)
  }

  // -------------------------------------------------------------------------
  // 引擎
  // -------------------------------------------------------------------------

  async engines(force = false): Promise<EngineInfo[]> {
    const list = await Promise.all(
      ENGINE_ORDER.map(id => this.adapters[id]?.info(force) ?? Promise.resolve(unsupportedInfo(id))),
    )
    if (force) this.opts.emit({ kind: 'engines', engines: list })
    return list
  }

  /** 新会话默认值：默认引擎 + 这个引擎的默认值 */
  defaults(): EngineDefaults {
    return { ...this.settings.defaults, ...this.engineDefaults(this.settings.defaults.engine) }
  }

  /** 一个引擎的新会话默认值；旧版只有一份全局默认，没单独记过的引擎沿用它（docs/ui/engine-settings-redesign.md §4） */
  private engineDefaults(engine: EngineId): SessionDefaults {
    const d = this.settings.defaults
    const legacy: SessionDefaults = {
      model: d.model,
      effort: d.effort,
      permissionMode: d.permissionMode,
      ultracode: d.ultracode,
      fast: d.fast,
      thinkingSummaries: d.thinkingSummaries,
    }
    return { ...legacy, ...(this.settings.engineDefaults[engine] ?? {}) }
  }

  /** 设置 › 本机引擎里的引擎级选项，启动引擎进程时读（自带的适配器自动接上；测试里自己建的适配器也可以接它） */
  launchOptions(engine: EngineId): {
    outputStyle: string | null
    askQuestions: boolean
    autoCompactPct: number | null
  } {
    const o = this.settings.options[engine] ?? {}
    return {
      outputStyle: o.outputStyle ?? null,
      askQuestions: o.askQuestions !== false,
      autoCompactPct: o.autoCompactPct ?? null,
    }
  }

  /** 启动进程要用到的全部引擎级设置；和进程启动时的不同，就在下一条消息前重启进程（--resume 接上原对话） */
  private launchKey(engine: EngineId): string {
    return JSON.stringify([
      this.settings.paths[engine] ?? null,
      this.settings.env[engine] ?? {},
      this.launchOptions(engine),
    ])
  }

  /** 各引擎的本机配置：路径、追加的环境变量、压缩模型（设置 › 本机引擎） */
  engineConfig(): EngineConfig {
    const one = (id: EngineId): EngineLocalConfig => ({
      path: this.settings.paths[id] ?? null,
      env: { ...(this.settings.env[id] ?? {}) },
      compactModel: this.settings.compactModels[id] ?? null,
      defaults: this.engineDefaults(id),
      ...this.launchOptions(id),
      hidden: this.settings.options[id]?.hidden === true && id !== this.settings.defaults.engine,
    })
    return Object.fromEntries(ENGINE_ORDER.map(id => [id, one(id)])) as EngineConfig
  }

  /** 改一个引擎的本机配置；路径或环境变量变了就重新检测（检测结果会广播） */
  async setEngineConfig(engine: EngineId, patch: EngineConfigPatch): Promise<EngineConfig> {
    if (!ENGINE_ORDER.includes(engine)) throw new Error('未知引擎')
    const next: EngineSettingsFile = {
      ...this.settings,
      paths: { ...this.settings.paths },
      env: { ...this.settings.env },
      compactModels: { ...this.settings.compactModels },
      engineDefaults: { ...this.settings.engineDefaults },
      options: { ...this.settings.options },
    }
    const options = { ...(next.options[engine] ?? {}) }
    let redetect = false
    if (patch.path !== undefined) {
      const path = patch.path?.trim() ?? ''
      if (path) next.paths[engine] = path
      else delete next.paths[engine]
      redetect = true
    }
    if (patch.env !== undefined) {
      const env: Record<string, string> = {}
      for (const [k, v] of Object.entries(patch.env)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`环境变量名不对：${k}`)
        if (typeof v !== 'string') throw new Error(`环境变量 ${k} 的值不对`)
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
      if (patch.hidden && engine === this.settings.defaults.engine)
        throw new Error('默认引擎不能隐藏，先换一个默认引擎')
      if (patch.hidden) options.hidden = true
      else delete options.hidden
    }
    if (Object.keys(options).length > 0) next.options[engine] = options
    else delete next.options[engine]
    this.store.saveSettings(next)
    this.settings = next
    if (redetect) await this.engines(true)
    const config = this.engineConfig()
    this.opts.emit({ kind: 'engine_config', config })
    return config
  }

  /** 设为默认引擎（新会话用它）；默认引擎不能隐藏，所以顺手取消隐藏 */
  setDefaultEngine(engine: EngineId): EngineDefaults {
    if (!ENGINE_ORDER.includes(engine) || !this.adapters[engine]) throw new Error('这个引擎暂不支持')
    const options = { ...this.settings.options }
    if (options[engine]?.hidden) {
      const { hidden: _hidden, ...rest } = options[engine]!
      if (Object.keys(rest).length > 0) options[engine] = rest
      else delete options[engine]
    }
    this.settings = { ...this.settings, defaults: { ...this.settings.defaults, engine }, options }
    this.store.saveSettings(this.settings)
    this.opts.emit({ kind: 'engine_config', config: this.engineConfig() })
    return this.defaults()
  }

  /** 引擎实际报上来的可选项（输出风格）；不发消息、不花钱 */
  async engineCatalog(engine: EngineId, force = false): Promise<EngineCatalog> {
    const adapter = this.adapters[engine]
    return adapter?.catalog ? adapter.catalog(force) : { outputStyles: [], currentOutputStyle: null }
  }

  /** 检查更新：交给引擎自己的更新命令，结束后重新检测并广播 */
  async updateEngine(engine: EngineId): Promise<EngineUpdateResult> {
    const adapter = this.adapters[engine]
    if (!adapter?.update) throw new Error('这个引擎不支持在软件里更新')
    const result = await adapter.update()
    const list = await this.engines(true)
    return { ...result, version: list.find(e => e.id === engine)?.version ?? null }
  }

  retrySettings(): { maxRetries: number | null } {
    return { maxRetries: this.settings.maxRetries }
  }

  setRetrySettings(value: unknown): { maxRetries: number | null } {
    const maxRetries = retryLimit(value)
    const next = { ...this.settings, maxRetries }
    this.store.saveSettings(next)
    this.settings = next
    const settings = this.retrySettings()
    this.opts.emit({ kind: 'retry_settings', settings })
    return settings
  }

  /** 记住会话里改过的选择：写到 patch.engine（缺省为默认引擎）名下的默认值，不改默认引擎 */
  setDefaults(patch: Partial<EngineDefaults>): EngineDefaults {
    const engine = patch.engine ?? this.settings.defaults.engine
    const { engine: _engine, platform: _platform, ...rest } = patch
    const next: SessionDefaults = { ...this.engineDefaults(engine), ...checkDefaults(rest) }
    this.settings = { ...this.settings, engineDefaults: { ...this.settings.engineDefaults, [engine]: next } }
    this.store.saveSettings(this.settings)
    return this.defaults()
  }

  // -------------------------------------------------------------------------
  // 项目
  // -------------------------------------------------------------------------

  projects(): ProjectRecord[] {
    return [...this.projectList]
  }

  /** 添加项目；同一个目录只添加一次 */
  addProject(path: string): ProjectRecord {
    const abs = resolve(path)
    if (!isDir(abs)) throw new Error(`目录不存在：${abs}`)
    const same = this.projectList.find(p => this.workspaceKey(p.path) === this.workspaceKey(abs))
    if (same) return same
    const project: ProjectRecord = { id: randomUUID(), name: basename(abs) || abs, path: abs, addedAt: Date.now() }
    this.projectList = [...this.projectList, project]
    this.store.saveProjects(this.projectList)
    this.opts.emit({ kind: 'projects', projects: this.projects() })
    return project
  }

  /** 改侧栏显示的项目名；只改名称，不动磁盘上的文件夹 */
  renameProject(id: string, name: unknown): ProjectRecord {
    const value = normalizeProjectName(name)
    const project = this.projectList.find(p => p.id === id)
    if (!project) throw new Error('项目不存在')
    const renamed = { ...project, name: value }
    this.projectList = this.projectList.map(p => (p.id === id ? renamed : p))
    this.store.saveProjects(this.projectList)
    this.opts.emit({ kind: 'projects', projects: this.projects() })
    return renamed
  }

  /** 从列表里移除项目（不删除磁盘上的任何文件，会话记录保留） */
  removeProject(id: string): void {
    this.projectList = this.projectList.filter(p => p.id !== id)
    this.store.saveProjects(this.projectList)
    this.opts.emit({ kind: 'projects', projects: this.projects() })
  }

  // -------------------------------------------------------------------------
  // 会话
  // -------------------------------------------------------------------------

  sessions(): SessionSummary[] {
    return [...this.records.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(record => {
        const queue = this.queueSummary(record.id)
        return { record, state: this.runtimes.get(record.id)?.snapshot.state ?? 'idle', ...(queue ? { queue } : {}) }
      })
  }

  /** 没打开过的会话读一次已保存的队列（之后由运行时接管），任务 › 待处理用（docs/ui/tasks-inbox.md §4） */
  private readonly queueHints = new Map<string, QueueSummary | null>()
  private queueSummary(id: string): QueueSummary | null {
    const rt = this.runtimes.get(id)
    if (rt) {
      const queue = rt.snapshot.queue
      if (!queue.length) return null
      const failed = queue.filter(q => q.status === 'failed' || q.status === 'uncertain').length
      return { queued: queue.length - failed, failed, paused: rt.snapshot.queuePaused }
    }
    if (!this.queueHints.has(id)) this.queueHints.set(id, this.store.peekQueue(id))
    return this.queueHints.get(id) ?? null
  }
  /** 上次广播时的队列状态：只在「有排队且暂停」或排队数变化时重新广播会话列表 */
  private readonly queueKeys = new Map<string, string>()

  /** 全局搜索只读取已存在的运行时或异步历史，不启动引擎。 */
  search(value: unknown, signal?: AbortSignal) {
    return searchSessions(
      {
        dataDir: this.store.dir,
        records: [...this.records.values()],
        projects: this.projects(),
        liveItems: id => this.runtimes.get(id)?.snapshot.items,
        exists: id => this.records.has(id),
      },
      searchQuery(value),
      signal,
    )
  }

  /** 产物面板：工作区内最近几天的改动和交付（docs/ui/artifacts-panel.md），不启动引擎 */
  artifacts(value: unknown, workspace: string, signal?: AbortSignal) {
    return collectArtifacts(
      {
        dataDir: this.store.dir,
        records: [...this.records.values()],
        liveItems: id => this.runtimes.get(id)?.snapshot.items,
      },
      artifactQuery(value, workspace),
      signal,
    )
  }

  private async artifactItems(sessionId: string): Promise<{ record: SessionRecord; items: readonly Item[] }> {
    const record = this.records.get(sessionId)
    if (!record) throw new Error('会话不存在')
    const live = this.runtimes.get(sessionId)?.snapshot.items
    return {
      record,
      items: live ?? (await historyItems(join(this.store.dir, 'sessions', sessionId, 'items.jsonl'))).items,
    }
  }

  /** 一条改文件记录（产物面板看差异用） */
  async artifactItem(sessionId: string, itemId: string): Promise<Extract<Item, { kind: 'file_change' }> | null> {
    const { items } = await this.artifactItems(sessionId)
    const item = items.find(i => i.id === itemId)
    return item?.kind === 'file_change' ? item : null
  }

  /** 这个会话的改动记录里出现过这个路径吗：读取 / 打开工作区外文件前的安全检查 */
  async recordedPath(sessionId: string, absolute: string): Promise<boolean> {
    const { record, items } = await this.artifactItems(sessionId)
    return recordedIn(record, items, absolute)
  }

  private broadcastSessions(): void {
    this.opts.emit({ kind: 'sessions', sessions: this.sessions() })
  }

  createSession(
    opts: { projectId: string } & Partial<SessionSettings> & { engine?: EngineId },
    workspacePath?: string,
  ): SessionRecord {
    const project = this.projectList.find(p => p.id === opts.projectId)
    if (!project) throw new Error('项目不存在')
    if (this.lockedWorkspaces.has(this.workspaceKey(workspacePath ?? project.path)))
      throw new Error('工作目录正在维护，请稍后重试')
    const engine = opts.engine ?? this.settings.defaults.engine
    const d = this.engineDefaults(engine)
    const now = Date.now()
    const record: SessionRecord = {
      id: randomUUID(),
      projectId: project.id,
      cwd: workspacePath ?? project.path,
      engine,
      engineSessionId: null,
      title: NEW_TITLE,
      model: opts.model !== undefined ? opts.model : d.model,
      platform: opts.platform ?? null,
      effort: opts.effort !== undefined ? opts.effort : d.effort,
      permissionMode: opts.permissionMode ?? d.permissionMode,
      ultracode: opts.ultracode ?? d.ultracode,
      fast: opts.fast ?? d.fast,
      thinkingSummaries: opts.thinkingSummaries ?? d.thinkingSummaries,
      createdAt: now,
      updatedAt: now,
      lastOutcome: null,
      archivedAt: null,
      bottomedAt: null,
      titleEdited: false,
    }
    this.records.set(record.id, record)
    this.store.saveRecord(record)
    this.broadcastSessions()
    return record
  }

  private runtime(id: string): Runtime {
    let rt = this.runtimes.get(id)
    if (rt) return rt
    const record = this.records.get(id)
    if (!record) throw new Error('会话不存在')
    const snapshot = emptySnapshot(record, this.store.loadItems(id))
    if (record.platform)
      snapshot.items = snapshot.items.map(item =>
        item.kind === 'turn_stats' && !item.usage.settlement
          ? {
              ...item,
              usage: {
                ...item.usage,
                models: Object.fromEntries(
                  Object.entries(item.usage.models).map(([name, m]) => [
                    name,
                    m.costSource ? m : { ...m, costUsd: null, costSource: 'unavailable' as const },
                  ]),
                ),
              },
            }
          : item,
      )
    const saved = this.store.loadQueue(record)
    snapshot.queue = saved.items
    snapshot.queuePaused = saved.paused
    try {
      const runs = this.adapters[record.engine]?.loadRuns?.(record)
      if (runs) snapshot.runs = runs
    } catch {
      // 读不到以前的追踪数据不影响打开会话
    }
    rt = {
      snapshot,
      seq: 0,
      session: null,
      idleTimer: null,
      receipts: saved.receipts,
      pumping: false,
      stopping: false,
      generation: 0,
      activeId: null,
      execution: null,
      sessionSource: undefined,
      pumpFinished: null,
      sessionMaxRetries: undefined,
    }
    this.runtimes.set(id, rt)
    // The original account and request IDs are persisted, never inferred from the current route.
    queueMicrotask(() => {
      for (const item of snapshot.items)
        if (item.kind === 'turn_stats' && item.usage.settlement && !item.usage.settlement.complete) {
          this.startSettlement(id, item.turnId, item.outcome, item.usage)
        }
    })
    return rt
  }

  /** 当前快照 */
  open(id: string): SessionSnapshot {
    return this.runtime(id).snapshot
  }

  /** 打开会话（给界面用）：快照 + 序号，之后界面只应用序号更大的事件 */
  openSession(id: string): OpenedSession {
    const rt = this.runtime(id)
    for (const item of rt.snapshot.items)
      if (item.kind === 'turn_stats' && item.usage.settlement && !item.usage.settlement.complete)
        this.startSettlement(id, item.turnId, item.outcome, item.usage)
    return { snapshot: rt.snapshot, seq: rt.seq }
  }

  /** 应用一个事件：更新快照、保存、广播 */
  private apply(id: string, event: EngineEvent): void {
    const rt = this.runtimes.get(id)
    if (!rt) return
    rt.snapshot = reduce(rt.snapshot, event)
    rt.seq++
    if (event.type === 'item_completed') this.store.appendItem(id, event.item)
    if (event.type === 'record') {
      this.records.set(id, event.record)
      this.store.saveRecord(event.record)
    }
    this.opts.emit({ kind: 'session', sessionId: id, seq: rt.seq, event })
    if (event.type === 'status' || event.type === 'record') this.broadcastSessions()
  }

  private patchRecord(id: string, patch: Partial<SessionRecord>): SessionRecord {
    const rt = this.runtime(id)
    if (patch.model !== undefined || patch.platform !== undefined || patch.engine !== undefined) {
      this.cacheWatches.delete(id)
      if (rt.snapshot.context)
        this.apply(id, { type: 'context', context: { ...rt.snapshot.context, stale: true, diagnosticStale: true } })
    }
    const record = { ...rt.snapshot.record, ...patch }
    this.apply(id, { type: 'record', record })
    return record
  }

  /** 适配器发来的事件：在这里推导运行状态 */
  private onEngineEvent(id: string, event: EngineEvent): void {
    const rt = this.runtimes.get(id)
    if (!rt) return
    // 已结束轮次的迟到 result 不能清理正在执行的新轮和审批。
    if (event.type === 'turn_completed' && event.turnId !== rt.snapshot.turnId) return
    if (event.type === 'request_cache_reset') {
      this.cacheWatches.delete(id)
      return
    }
    if (event.type === 'request_usage') {
      const r = event.request
      if (rt.snapshot.turnId !== r.turnId || rt.snapshot.state === 'idle' || rt.stopping) return
      const record = rt.execution ?? rt.snapshot.record
      const route = JSON.stringify([record.engine, record.model, record.platform ?? null])
      let watch = this.cacheWatches.get(id)
      if (!watch) {
        watch = new CacheWatch()
        this.cacheWatches.set(id, watch)
      }
      const miss = watch.check(r, route)
      if (miss && this.cacheAlertTurns.get(id) !== r.turnId) {
        this.cacheAlertTurns.set(id, r.turnId)
        this.opts.emit({
          kind: 'cache_warning',
          warning: {
            sessionId: id,
            turnId: r.turnId,
            messageId: r.messageId,
            title: rt.snapshot.record.title,
            model: r.model,
            input: miss.input,
            cached: r.cacheRead,
            previousInput: miss.previousInput,
            expiresAt: r.observedAt + 5_000,
          },
        })
      }
      return
    }
    this.apply(id, event)
    switch (event.type) {
      case 'turn_started':
        this.apply(id, { type: 'status', state: 'running' })
        break
      case 'approval_request':
        this.apply(id, { type: 'status', state: 'waiting' })
        break
      case 'approval_resolved':
        if (rt.snapshot.turnId && rt.snapshot.pending.length === 0) this.apply(id, { type: 'status', state: 'running' })
        break
      case 'turn_completed': {
        if (event.usage || this.platformRequests.has(`${id}:${event.turnId}`))
          this.recordUsage(id, event.turnId, event.outcome, event.usage ?? { models: {}, durationMs: 0 })
        this.patchRecord(id, {
          lastOutcome: event.outcome,
          lastError: event.outcome === 'failed' ? (event.error ?? '').slice(0, 500) || null : null,
          updatedAt: Date.now(),
        })
        if (rt.activeId) {
          const item = rt.snapshot.queue.find(q => q.id === rt.activeId)
          if (item && event.outcome === 'failed')
            this.changeQueue(id, item.id, { status: 'failed', error: event.error ?? '任务执行失败' })
          else if (item) this.removeQueue(id, item.id, 'accepted')
          rt.activeId = null
        }
        const awaitingGuidance = rt.snapshot.queue.some(q => q.status === 'delivering')
        if (!awaitingGuidance) rt.execution = null
        if (event.outcome !== 'completed') rt.snapshot = { ...rt.snapshot, queuePaused: true }
        this.publishQueue(id)
        this.apply(id, { type: 'status', state: awaitingGuidance ? 'starting' : 'idle' })
        // 必须等适配器旧轮的 turnEnded / 审批清理回调返回，再派发下一条。
        queueMicrotask(() => {
          void this.pump(id)
        })
        if (rt.snapshot.queuePaused || rt.snapshot.queue.length === 0) this.armIdle(id)
        break
      }
      case 'input_ack': {
        const input = rt.snapshot.queue.find(q => q.id === event.id && q.mode === 'guidance')
        if (input) {
          if (event.state === 'consumed') {
            this.apply(id, {
              type: 'item_completed',
              item: {
                kind: 'user',
                id: input.id,
                text: input.text,
                attachments: input.attachments,
                createdAt: Date.now(),
                mode: event.mode ?? 'guidance',
                turnId: rt.snapshot.turnId ?? undefined,
              },
            })
            this.removeQueue(id, input.id, 'accepted')
          } else if (event.state === 'cancelled')
            this.changeQueue(id, input.id, { status: 'queued', mode: 'normal', error: null })
          else {
            rt.snapshot = { ...rt.snapshot, queuePaused: true }
            this.changeQueue(id, input.id, { status: 'uncertain', error: '引擎退出前未确认是否采纳，请核对后重试' })
          }
        }
        break
      }
    }
  }

  private armIdle(id: string): void {
    const rt = this.runtimes.get(id)
    if (!rt) return
    if (rt.idleTimer) clearTimeout(rt.idleTimer)
    rt.idleTimer = setTimeout(() => {
      rt.idleTimer = null
      if (rt.snapshot.state !== 'idle' || !rt.session) return
      const s = rt.session
      rt.session = null
      void s.close()
    }, this.idleMs)
    rt.idleTimer.unref?.()
  }

  async send(id: string, input: string | MessageInput): Promise<SendReceipt> {
    if (this.closing) throw new Error('应用正在退出')
    if (this.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const rt = this.runtime(id)
    if (this.lockedWorkspaces.has(this.workspaceKey(rt.snapshot.record.cwd)))
      throw new Error('工作目录正在维护，请稍后重试')
    if (!statSync(rt.snapshot.record.cwd).isDirectory()) throw new Error('项目目录不存在')
    const v = messageInput(input, rt.snapshot.record, randomUUID)
    if (v.attachments?.length && !ENGINES[rt.snapshot.record.engine].caps.imageInput)
      throw new Error('当前引擎不支持图片输入')
    const duplicate = rt.receipts.find(r => r.queueId === v.clientMessageId)
    if (duplicate) return duplicate
    if (rt.snapshot.queue.some(q => q.id === v.clientMessageId)) return { queueId: v.clientMessageId, status: 'queued' }
    const item: QueuedMessage = {
      id: v.clientMessageId,
      text: v.text,
      attachments: v.attachments,
      settings: v.settings,
      createdAt: Date.now(),
      status: 'queued',
      error: null,
      mode: 'normal',
    }
    // 没有对话在运行：用户这次发送就是「现在执行」。之前暂停的排队项单独保持暂停，
    // 失败 / 待核对项留给用户处理，都不会挡住这条，也不会被它顺带执行。
    const idle = rt.snapshot.state === 'idle' && !rt.pumping && !rt.stopping && !rt.activeId
    const held = idle && rt.snapshot.queuePaused
    const queue = rt.snapshot.queue.map(q => (held && q.status === 'queued' ? { ...q, held: true } : q))
    // 前面没有会先执行的排队项时，这条就是「现在执行」，界面不把它当排队显示。
    if (idle && !queue.some(q => q.status === 'queued' && !q.held)) item.direct = true
    const next = { ...rt.snapshot, queue: [...queue, item], queuePaused: idle ? false : rt.snapshot.queuePaused }
    // 先落盘，再承诺接收；磁盘失败时保持原快照，输入框原文不会被清空。
    this.store.saveQueue(id, { items: next.queue, paused: next.queuePaused, receipts: rt.receipts })
    rt.snapshot = next
    if (rt.snapshot.record.archivedAt) this.patchRecord(id, { archivedAt: null })
    if (rt.snapshot.suggestion) this.apply(id, { type: 'suggestion', text: null })
    this.publishQueue(id)
    queueMicrotask(() => {
      void this.pump(id)
    })
    return { queueId: item.id, status: 'queued' }
  }

  async inspectContext(id: string): Promise<import('@pixelsky/protocol').ContextDiagnostic> {
    const rt = this.runtime(id)
    if (
      this.closing ||
      rt.snapshot.state !== 'idle' ||
      rt.snapshot.queue.length ||
      rt.pumping ||
      rt.stopping ||
      rt.inspectingContext
    )
      throw new Error('等待当前任务和排队消息结束后刷新明细')
    if (!rt.session?.context || !rt.snapshot.flags.contextAvailable)
      throw new Error('先运行会话，或升级到支持上下文诊断的 Claude Code')
    if (rt.idleTimer) {
      clearTimeout(rt.idleTimer)
      rt.idleTimer = null
    }
    rt.inspectingContext = true
    try {
      return await rt.session.context()
    } finally {
      rt.inspectingContext = false
      this.armIdle(id)
      queueMicrotask(() => {
        void this.pump(id)
      })
    }
  }

  async compactContext(id: string): Promise<SendReceipt> {
    const rt = this.runtime(id)
    if (
      this.closing ||
      rt.snapshot.state !== 'idle' ||
      rt.snapshot.queue.length ||
      rt.pumping ||
      rt.stopping ||
      rt.inspectingContext
    )
      throw new Error('等待当前任务和排队消息结束后压缩')
    if (!rt.session || !rt.snapshot.flags.compactAvailable) throw new Error('当前引擎不支持原生压缩，或会话尚未开始')
    const receipt = await this.send(id, '/compact')
    if (rt.snapshot.context)
      this.apply(id, {
        type: 'context',
        context: { ...rt.snapshot.context, stale: true, compacting: true, diagnosticStale: true },
      })
    return receipt
  }

  async interrupt(id: string): Promise<void> {
    const rt = this.runtime(id)
    rt.generation++
    rt.snapshot = { ...rt.snapshot, queuePaused: true }
    this.publishQueue(id)
    if (rt.stopping) return
    rt.stopping = true
    try {
      await rt.session?.interrupt()
    } finally {
      rt.stopping = false
      if (!rt.snapshot.turnId && !rt.pumping) {
        rt.execution = null
        this.apply(id, { type: 'status', state: 'idle' })
      }
    }
  }

  /** 核对轮次后同步进入现有停止和队列锁；旧提醒不能暂停或中断下一轮。 */
  async interruptTurn(id: string, expectedTurnId: string): Promise<boolean> {
    const rt = this.runtimes.get(id)
    if (!rt || rt.snapshot.turnId !== expectedTurnId || rt.snapshot.state === 'idle') return false
    await this.interrupt(id)
    return true
  }

  private publishQueue(id: string): void {
    const rt = this.runtime(id)
    this.store.saveQueue(id, { items: rt.snapshot.queue, paused: rt.snapshot.queuePaused, receipts: rt.receipts })
    this.apply(id, { type: 'queue', items: rt.snapshot.queue, paused: rt.snapshot.queuePaused })
    const key = rt.snapshot.queuePaused && rt.snapshot.queue.length ? `p${rt.snapshot.queue.length}` : ''
    if ((this.queueKeys.get(id) ?? '') !== key) {
      this.queueKeys.set(id, key)
      this.broadcastSessions()
    }
  }

  private changeQueue(id: string, queueId: string, patch: Partial<QueuedMessage>): void {
    const rt = this.runtime(id)
    rt.snapshot = { ...rt.snapshot, queue: rt.snapshot.queue.map(q => (q.id === queueId ? { ...q, ...patch } : q)) }
    this.publishQueue(id)
  }

  private removeQueue(id: string, queueId: string, status: SendReceipt['status']): void {
    const rt = this.runtime(id)
    rt.receipts = [...rt.receipts.filter(r => r.queueId !== queueId), { queueId, status }].slice(-256)
    rt.snapshot = { ...rt.snapshot, queue: rt.snapshot.queue.filter(q => q.id !== queueId) }
    this.publishQueue(id)
  }

  cancelQueued(id: string, queueId: string): string {
    const item = this.runtime(id).snapshot.queue.find(q => q.id === queueId)
    if (!item) throw new Error('这条消息已开始处理或已经撤回')
    if (['running', 'dispatching', 'delivering'].includes(item.status)) throw new Error('这条消息已开始交付，无法撤回')
    this.removeQueue(id, queueId, 'cancelled')
    return item.text
  }

  moveQueued(id: string, queueId: string, toIndex: number): void {
    const rt = this.runtime(id)
    const source = rt.snapshot.queue.findIndex(q => q.id === queueId)
    if (source < 0 || rt.snapshot.queue[source].status !== 'queued') throw new Error('只有排队中的消息可以调序')
    const items = [...rt.snapshot.queue]
    const item = items.splice(source, 1)[0]
    const index = Math.max(0, Math.min(items.length, Math.trunc(toIndex)))
    items.splice(index, 0, item)
    rt.snapshot = { ...rt.snapshot, queue: items }
    this.publishQueue(id)
  }

  resumeQueue(id: string): void {
    if (this.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const rt = this.runtime(id)
    if (rt.stopping) throw new Error('正在停止当前任务，请稍后继续')
    // 失败 / 待核对项留给用户处理，继续时只派发排队中的消息。
    if (rt.snapshot.record.archivedAt) this.patchRecord(id, { archivedAt: null })
    rt.snapshot = {
      ...rt.snapshot,
      queuePaused: false,
      queue: rt.snapshot.queue.map(q => (q.held ? { ...q, held: false } : q)),
    }
    this.publishQueue(id)
    queueMicrotask(() => {
      void this.pump(id)
    })
  }

  async runQueuedNow(id: string, queueId: string): Promise<void> {
    if (this.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const rt = this.runtime(id)
    if (rt.stopping) throw new Error('正在停止当前任务，请稍后重试')
    const item = rt.snapshot.queue.find(q => q.id === queueId)
    if (!item || ['dispatching', 'running', 'delivering'].includes(item.status)) throw new Error('这条消息已经开始交付')
    await this.interrupt(id)
    await rt.pumpFinished
    if (this.runtimes.get(id) !== rt || this.closing) throw new Error('会话已关闭')
    // 中断可能与完成事件竞争，仍使用稳定 ID 领取选中的任务。
    if (!rt.snapshot.queue.some(q => q.id === queueId)) throw new Error('这条消息已经开始处理')
    if (rt.snapshot.state !== 'idle' || rt.pumping) throw new Error('当前任务还没有停止，请稍后重试')
    if (rt.snapshot.record.archivedAt) this.patchRecord(id, { archivedAt: null })
    rt.snapshot = {
      ...rt.snapshot,
      queue: [
        { ...item, status: 'queued', mode: 'normal', error: null, held: false, direct: true },
        ...rt.snapshot.queue.filter(q => q.id !== queueId),
      ],
      queuePaused: false,
    }
    this.publishQueue(id)
    await this.pump(id)
  }

  async steerQueued(id: string, queueId: string, expectedTurnId: string): Promise<void> {
    const rt = this.runtime(id)
    if (rt.snapshot.state !== 'running' || rt.snapshot.turnId !== expectedTurnId || rt.stopping)
      throw new Error('当前一轮已结束或正在等待审批')
    if (!rt.snapshot.flags.steerAvailable || !rt.session?.steer)
      throw new Error('当前引擎尚未通过运行中引导验证，可等待或插队')
    const item = rt.snapshot.queue.find(q => q.id === queueId && q.status === 'queued')
    if (!item) throw new Error('这条消息已经开始交付')
    if (!sameQueueSettings(item.settings, queueSettings(rt.execution ?? rt.snapshot.record)))
      throw new Error('设置与当前任务不同，可等待或插队')
    this.changeQueue(id, queueId, { status: 'delivering', mode: 'guidance' })
    try {
      await rt.session.steer(item.text, item.id, item.attachments)
    } catch (err) {
      this.changeQueue(id, queueId, { status: 'uncertain', error: `引导交付结果待核对：${(err as Error).message}` })
      rt.snapshot = { ...rt.snapshot, queuePaused: true }
      this.publishQueue(id)
      throw err
    }
  }

  private async pump(id: string): Promise<void> {
    const rt = this.runtimes.get(id)
    if (
      !rt ||
      this.lockedWorkspaces.has(this.workspaceKey(rt.snapshot.record.cwd)) ||
      this.closing ||
      this.changingSessions.has(id) ||
      rt.snapshot.record.archivedAt ||
      rt.pumping ||
      rt.stopping ||
      rt.inspectingContext ||
      rt.snapshot.state !== 'idle'
    )
      return
    // 失败 / 待核对和单独暂停的项不堵住队首，取第一条可执行的消息。
    const item = rt.snapshot.queuePaused ? undefined : rt.snapshot.queue.find(q => q.status === 'queued' && !q.held)
    if (!item) return
    rt.pumping = true
    let finishPump!: () => void
    rt.pumpFinished = new Promise<void>(resolve => {
      finishPump = resolve
    })
    const generation = rt.generation
    const stillCurrent = () =>
      !this.closing && this.runtimes.get(id) === rt && generation === rt.generation && !rt.snapshot.queuePaused
    this.changeQueue(id, item.id, { status: 'dispatching' })
    this.apply(id, { type: 'status', state: 'starting' })
    let preparedExtensions: import('@pixelsky/protocol').ExtensionLaunch | undefined
    try {
      const record = { ...rt.snapshot.record, ...item.settings }
      const adapter = this.adapters[record.engine]
      if (!adapter) throw new Error('这个引擎暂不支持')
      const info = await adapter.info()
      if (!stillCurrent()) return
      if (item.attachments?.length && !info.caps.imageInput) throw new Error('当前引擎不支持图片输入')
      if (info.status !== 'ready' && !(record.platform && info.status === 'unauthenticated'))
        throw new Error(info.message ?? `${info.name} 不可用`)
      await this.opts.validateInput?.(record)
      if (!stillCurrent()) return
      if (rt.idleTimer) {
        clearTimeout(rt.idleTimer)
        rt.idleTimer = null
      }
      const source = record.platform?.account ?? null
      const maxRetries = this.settings.maxRetries
      const extensions = (preparedExtensions = this.opts.extensions?.(record))
      const launch = this.launchKey(record.engine) + (extensions?.key ?? '')
      // 额度来源、重试次数或引擎级设置（输出风格、允许提问、压缩触发点、路径、环境变量）变了：换一个进程，--resume 接上原对话
      if (
        rt.session &&
        (rt.sessionSource !== source || rt.sessionMaxRetries !== maxRetries || rt.sessionLaunch !== launch)
      ) {
        const old = rt.session
        rt.session = null
        await old.close()
      }
      if (!stillCurrent()) return
      rt.execution = { ...rt.snapshot.record, ...item.settings }
      if (!rt.session) {
        rt.sessionSource = source
        rt.sessionMaxRetries = maxRetries
        rt.sessionLaunch = launch
        rt.session = adapter.createSession({
          extensions,
          maxRetries,
          record: () => ({ ...this.runtime(id).snapshot.record, ...(this.runtime(id).execution ?? {}) }),
          emit: e => this.onEngineEvent(id, e),
          setEngineSessionId: engineSessionId => {
            if (rt.execution) rt.execution.engineSessionId = engineSessionId
            this.patchRecord(id, { engineSessionId })
          },
          setPermissionMode: permissionMode => {
            if (rt.execution) rt.execution.permissionMode = permissionMode
            this.patchRecord(id, { permissionMode })
          },
          setUltracode: ultracode => {
            if (rt.execution) rt.execution.ultracode = ultracode
            this.patchRecord(id, { ultracode })
          },
          setFast: fast => {
            if (rt.execution) rt.execution.fast = fast
            this.patchRecord(id, { fast })
          },
          clearPendingRewind: () => {
            if (rt.execution) rt.execution.pendingRewind = null
            this.patchRecord(id, { pendingRewind: null })
          },
        })
        preparedExtensions = undefined
      } else {
        extensions?.dispose?.()
        preparedExtensions = undefined
        await rt.session.update(rt.execution, true)
      }
      if (!stillCurrent()) return
      const turnId = randomUUID()
      const userItemId = item.attempt ? `${item.id}-retry-${randomUUID()}` : item.id
      rt.activeId = item.id
      this.changeQueue(id, item.id, { status: 'running', attempt: (item.attempt ?? 0) + 1, messageUuid: userItemId })
      this.apply(id, {
        type: 'item_completed',
        item: {
          kind: 'user',
          id: userItemId,
          text: item.text,
          attachments: item.attachments,
          createdAt: Date.now(),
          mode: 'normal',
          turnId,
        },
      })
      const latest = rt.snapshot.record
      this.patchRecord(id, {
        title:
          !latest.titleEdited && latest.title === NEW_TITLE
            ? titleFrom(item.text || item.attachments?.[0]?.name || NEW_TITLE)
            : latest.title,
        updatedAt: Date.now(),
      })
      if (rt.snapshot.suggestion) this.apply(id, { type: 'suggestion', text: null })
      this.apply(id, { type: 'status', state: 'running' })
      this.apply(id, { type: 'turn_started', turnId, execution: queueSettings(rt.execution) })
      rt.session.send(item.text, turnId, userItemId, item.attachments)
    } catch (err) {
      if (this.runtimes.get(id) !== rt) return
      this.changeQueue(id, item.id, { status: 'failed', error: (err as Error).message })
      rt.snapshot = { ...rt.snapshot, queuePaused: true }
      this.publishQueue(id)
      this.apply(id, { type: 'status', state: 'idle' })
    } finally {
      preparedExtensions?.dispose?.()
      rt.pumping = false
      rt.pumpFinished = null
      finishPump()
      if (!rt.activeId) {
        rt.execution = null
        if (rt.snapshot.queue.find(q => q.id === item.id)?.status === 'dispatching')
          this.changeQueue(id, item.id, { status: 'queued', direct: false })
        if (rt.snapshot.state === 'starting') this.apply(id, { type: 'status', state: 'idle' })
      }
    }
  }

  answer(id: string, requestId: string, decision: ApprovalDecision): void {
    const rt = this.runtimes.get(id)
    if (!rt?.session) return
    rt.session.answer(requestId, decision)
  }

  /** 会话记录（不创建运行时）；不存在时为 null。平台代理按请求读当前分组用 */
  record(id: string): SessionRecord | null {
    return this.runtimes.get(id)?.execution ?? this.records.get(id) ?? null
  }

  /**
   * 改设置 / 重命名。引擎只能在还没发过消息时改。
   * 额度来源（docs/ui/source-switch.md §3.4）：同一账号内换分组直接生效（平台代理按请求读分组）；
   * 平台 ↔ 自有或换账号要换一份启动环境，所以关掉当前引擎进程，下一条消息重新启动并 --resume 接上原对话。
   */
  async update(
    id: string,
    patch: Partial<SessionSettings> & { title?: string; engine?: EngineId },
  ): Promise<SessionRecord> {
    const rt = this.runtime(id)
    if (rt.inspectingContext) throw new Error('上下文诊断正在刷新，完成后再修改会话设置')
    const current = rt.snapshot.record
    const next: Partial<SessionRecord> = {}
    let restart = false
    if (patch.platform !== undefined && JSON.stringify(patch.platform) !== JSON.stringify(current.platform ?? null)) {
      const before = current.platform ?? null
      const sameSource = before === null ? patch.platform === null : patch.platform?.account === before.account
      if (!sameSource && (rt.snapshot.state !== 'idle' || rt.pumping)) throw new Error('这一轮结束后再切换额度来源')
      if (!sameSource && rt.session) {
        if (rt.snapshot.state !== 'idle') throw new Error('这一轮结束后再切换额度来源')
        restart = true
      }
      next.platform = patch.platform
    }
    if (patch.title !== undefined) {
      next.title = normalizeSessionTitle(patch.title)
      next.titleEdited = true
    }
    if (patch.model !== undefined) next.model = patch.model
    if (patch.effort !== undefined) next.effort = patch.effort
    if (patch.permissionMode !== undefined) next.permissionMode = patch.permissionMode
    if (patch.ultracode !== undefined) next.ultracode = patch.ultracode
    if (patch.fast !== undefined) next.fast = patch.fast
    if (patch.thinkingSummaries !== undefined) next.thinkingSummaries = patch.thinkingSummaries
    if (patch.engine !== undefined && patch.engine !== current.engine) {
      if (rt.snapshot.items.length > 0 || rt.session || rt.pumping || rt.snapshot.queue.length > 0)
        throw new Error('已经开始对话或有排队任务的会话不能换引擎，请新建会话')
      next.engine = patch.engine
    }
    const record = this.patchRecord(id, next)
    if (rt.execution) {
      const applied = { ...next }
      if (!ENGINES[current.engine].caps.liveModelSwitch && rt.snapshot.state !== 'idle') {
        delete applied.model
        delete applied.effort
      }
      if (!ENGINES[current.engine].caps.livePermissionSwitch && rt.snapshot.state !== 'idle')
        delete applied.permissionMode
      rt.execution = { ...rt.execution, ...applied }
    }
    if (rt.execution) this.apply(id, { type: 'execution', settings: queueSettings(rt.execution) })
    const settings: Partial<SessionSettings> = {}
    if (patch.model !== undefined) settings.model = patch.model
    if (patch.effort !== undefined) settings.effort = patch.effort
    if (patch.permissionMode !== undefined) settings.permissionMode = patch.permissionMode
    if (patch.ultracode !== undefined) settings.ultracode = patch.ultracode
    if (patch.fast !== undefined) settings.fast = patch.fast
    if (patch.thinkingSummaries !== undefined) settings.thinkingSummaries = patch.thinkingSummaries
    if (restart && rt.session) {
      if (rt.idleTimer) {
        clearTimeout(rt.idleTimer)
        rt.idleTimer = null
      }
      const s = rt.session
      rt.session = null
      await s.close()
    }
    if (Object.keys(settings).length > 0) {
      // 记住用户的选择，作为以后新会话的默认值
      this.setDefaults({ ...settings, engine: record.engine })
      await rt.session?.update(settings)
    }
    return record
  }

  /** 停止一个后台任务 */
  async stopTask(id: string, taskId: string): Promise<void> {
    const s = this.runtimes.get(id)?.session
    if (!s) throw new Error('引擎没有在运行')
    await s.stopTask(taskId)
  }

  /** 读一个后台任务的输出 */
  async taskOutput(id: string, taskId: string): Promise<TaskOutput> {
    const s = this.runtimes.get(id)?.session
    if (!s) throw new Error('引擎没有在运行')
    return s.taskOutput(taskId)
  }

  /** 智能体追踪：读一个子智能体的对话（只读） */
  subagentTranscript(id: string, agentId: string): Item[] | Promise<Item[]> {
    const record = this.runtime(id).snapshot.record
    const adapter = this.adapters[record.engine]
    if (!adapter?.subagentTranscript) throw new Error('这个引擎没有智能体追踪')
    if (record.engine === 'codex' && !this.runtime(id).snapshot.runs.agents.some(agent => agent.id === agentId))
      throw new Error('子智能体不属于当前会话')
    return adapter.subagentTranscript(record, agentId)
  }

  renameSession(id: string, title: unknown): SessionRecord {
    if (this.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const name = normalizeSessionTitle(title),
      rt = this.runtime(id)
    const record = this.patchRecord(id, { title: name, titleEdited: true })
    if (rt.execution) rt.execution = { ...rt.execution, title: name, titleEdited: true }
    return record
  }

  setSessionBottom(id: string, bottomed: boolean): SessionRecord {
    if (this.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const rt = this.runtime(id)
    if (Boolean(rt.snapshot.record.bottomedAt) === bottomed) return rt.snapshot.record
    const stamp = bottomed
      ? [...this.records.values()].reduce(
          (latest, record) => Math.max(latest, (record.bottomedAt ?? 0) + 1),
          Date.now(),
        )
      : null
    const record = this.patchRecord(id, { bottomedAt: stamp })
    if (rt.execution) rt.execution = { ...rt.execution, bottomedAt: stamp }
    return record
  }

  /**
   * 回退到某条用户消息之前：移除它及之后的全部对话，引擎下次启动时从它之前接上（docs/ui/chat-fixes-queue-actions-cost.md §2.3）。
   * 只在空闲时可用；返回被移除消息的原文和图片，界面放回输入框。
   */
  async rewind(id: string, userItemId: string): Promise<RewindResult> {
    if (this.closing) throw new Error('应用正在退出')
    if (this.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const rt = this.runtime(id)
    if (rt.snapshot.state !== 'idle' || rt.pumping || rt.stopping || rt.activeId || rt.inspectingContext)
      throw new Error('请先停止当前任务再回退')
    const record = rt.snapshot.record
    if (!ENGINES[record.engine].caps.rewind) throw new Error('当前引擎暂不支持回退')
    const index = rt.snapshot.items.findIndex(item => item.id === userItemId)
    const target = rt.snapshot.items[index]
    if (!target || target.kind !== 'user' || target.mode === 'guidance') throw new Error('只能回退到自己发送的消息')
    const dropped = rt.snapshot.items.slice(index).flatMap(item => (item.kind === 'user' ? [item.id] : []))
    this.changingSessions.add(id)
    try {
      // 关掉旧进程：它的上下文里还有要移除的对话
      const old = rt.session
      rt.session = null
      if (rt.idleTimer) {
        clearTimeout(rt.idleTimer)
        rt.idleTimer = null
      }
      await old?.close()
      const anchor = record.engineSessionId ? this.adapters[record.engine]?.rewindAnchor?.(record, dropped) : null
      this.store.replaceItems(id, rt.snapshot.items.slice(0, index))
      this.apply(id, { type: 'items_truncated', fromItemId: userItemId })
      this.cacheWatches.delete(id)
      // Missing native records must never silently preserve the discarded context.
      if (anchor)
        this.patchRecord(
          id,
          anchor.at ? { pendingRewind: anchor.at } : { engineSessionId: randomUUID(), pendingRewind: null },
        )
      else {
        this.patchRecord(id, { engineSessionId: randomUUID(), pendingRewind: null })
        if (record.engineSessionId)
          this.apply(id, {
            type: 'item_completed',
            item: {
              kind: 'notice',
              id: randomUUID(),
              level: 'warn',
              text: '无法在 Claude Code 记录中回退到这条消息，已开始新的引擎会话（之前的上下文没有带过去）',
            },
          })
      }
      if (rt.snapshot.context)
        this.apply(id, { type: 'context', context: { ...rt.snapshot.context, stale: true, diagnosticStale: true } })
      if (rt.snapshot.suggestion) this.apply(id, { type: 'suggestion', text: null })
      this.patchRecord(id, { updatedAt: Date.now() })
      return { text: target.text, ...(target.attachments?.length ? { attachments: target.attachments } : {}) }
    } finally {
      this.changingSessions.delete(id)
    }
  }

  async archiveSession(id: string, archived: boolean, stopRunning = false): Promise<void> {
    if (this.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const rt = this.runtime(id)
    if (Boolean(rt.snapshot.record.archivedAt) === archived) return
    if (archived && (rt.snapshot.state !== 'idle' || rt.pumping || rt.stopping) && !stopRunning)
      throw new Error('SESSION_RUNNING')
    this.changingSessions.add(id)
    try {
      if (archived) {
        await this.interrupt(id)
        const old = rt.session
        rt.session = null
        await old?.close()
        if (rt.snapshot.turnId)
          this.onEngineEvent(id, {
            type: 'turn_completed',
            turnId: rt.snapshot.turnId,
            outcome: 'interrupted',
            error: null,
          })
      }
      this.patchRecord(id, { archivedAt: archived ? Date.now() : null })
    } finally {
      this.changingSessions.delete(id)
    }
  }

  async deleteSession(id: string): Promise<void> {
    if (this.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    this.changingSessions.add(id)
    try {
      this.cacheWatches.delete(id)
      this.cacheAlertTurns.delete(id)
      const rt = this.runtimes.get(id)
      if (rt) {
        await this.interrupt(id)
        rt.generation++
        if (rt.idleTimer) clearTimeout(rt.idleTimer)
        this.runtimes.delete(id)
        await rt.session?.close()
      }
      this.records.delete(id)
      this.queueHints.delete(id)
      this.queueKeys.delete(id)
      this.store.deleteSession(id)
      this.broadcastSessions()
    } finally {
      this.changingSessions.delete(id)
    }
  }

  // -------------------------------------------------------------------------
  // 用量与调用记录（docs/ui/usage.md §6.2）
  // -------------------------------------------------------------------------

  /** 一轮结束：按模型写用量记录，并在对话流里加一行统计（显示在这一轮回复下方） */
  private recordUsage(id: string, turnId: string, outcome: TurnOutcome, usage: TurnUsage): void {
    const rt = this.runtimes.get(id)
    if (!rt) return
    const record = rt.execution ?? rt.snapshot.record
    const key = `${id}:${turnId}`
    if (record.platform) {
      usage = settleUsage(
        {
          ...usage,
          settlement: {
            account: record.platform.account,
            requests: this.platformRequests.get(key) ?? [],
            startedAt: Date.now() - usage.durationMs,
            complete: false,
          },
        },
        [],
        false,
      )
    }
    this.platformRequests.delete(key)
    const endedAt = Date.now()
    const project = this.projectList.find(p => p.id === record.projectId)?.name ?? null
    const rows: UsageRecord[] = Object.entries(usage.models).map(([model, m]) => ({
      v: 1,
      id: `${id}:${turnId}:${model}`,
      sessionId: id,
      turnId,
      startedAt: endedAt - usage.durationMs,
      endedAt,
      durationMs: usage.durationMs,
      sessionTitle: record.title,
      project,
      engine: record.engine,
      model,
      // 目前引擎都用命令行自己的登录；像素星空账号网关做好后是 'pixelsky'（Q5）
      route: record.platform ? 'pixelsky' : 'cli',
      requests: m.requests,
      input: m.input,
      cacheRead: m.cacheRead,
      cacheWrite: m.cacheWrite,
      output: m.output,
      costUsd: m.costUsd,
      costSource: m.costSource ?? 'estimate',
      billing: m.billing,
      outcome,
    }))
    try {
      this.usage.append(rows)
    } catch {
      // 写不进去（磁盘满、权限）不影响对话
    }
    this.apply(id, {
      type: 'item_completed',
      item: { kind: 'turn_stats', id: `stats-${turnId}`, turnId, outcome, usage },
    })
    this.opts.emit({ kind: 'usage_recorded' })
    if (usage.settlement) this.startSettlement(id, turnId, outcome, usage)
  }

  private startSettlement(id: string, turnId: string, outcome: TurnOutcome, original: TurnUsage): void {
    const key = `${id}:${turnId}`
    if (this.closing || this.settlements.has(key) || !original.settlement?.requests.length) return
    const controller = new AbortController(),
      epoch = this.usageEpoch
    this.settlements.set(key, controller)
    const charges = new Map<string, PlatformCharge>()
    const delays = this.opts.settlementDelays ?? [1000, 3000, 10000, 30000, 60000]
    void (async () => {
      for (let attempt = 0; attempt < delays.length; attempt++) {
        await new Promise<void>(resolve => {
          const done = () => {
            clearTimeout(timer)
            controller.signal.removeEventListener('abort', done)
            resolve()
          }
          const timer = setTimeout(done, delays[attempt])
          timer.unref()
          controller.signal.addEventListener('abort', done, { once: true })
        })
        if (controller.signal.aborted || this.closing || !this.records.has(id)) return
        try {
          const result = await this.opts.platformCharges?.(original.settlement!, controller.signal)
          for (const charge of result ?? []) charges.set(charge.requestId, charge)
        } catch {
          /* asynchronous billing or expired authentication: keep pending until the final attempt */
        }
        if (controller.signal.aborted || this.closing || !this.records.has(id)) return
        const usage = settleUsage(original, [...charges.values()], attempt === delays.length - 1)
        // Update only existing statistics. A rewind must not resurrect discarded messages.
        const rt = this.runtimes.get(id)
        if (rt?.snapshot.items.some(item => item.id === `stats-${turnId}`)) {
          this.apply(id, {
            type: 'item_completed',
            item: { kind: 'turn_stats', id: `stats-${turnId}`, turnId, outcome, usage },
          })
        }
        if (epoch === this.usageEpoch) {
          const rows = this.usage
            .load(original.settlement!.startedAt)
            .filter(row => row.sessionId === id && row.turnId === turnId)
          this.usage.append(
            rows.map(row => {
              const model = usage.models[row.model]
              return model ? { ...row, ...model } : row
            }),
          )
          this.opts.emit({ kind: 'usage_recorded' })
        }
        if (usage.settlement!.complete) return
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        if (this.settlements.get(key) === controller) this.settlements.delete(key)
      })
  }

  usageSummary(q: UsageQuery): UsageSummary {
    return this.usage.summary(q)
  }

  usageList(q: UsageQuery & { offset: number; limit: number }): UsagePage {
    return this.usage.list(q)
  }

  usageCsv(q: UsageQuery): string {
    return this.usage.csv(q)
  }

  usageClear(): void {
    this.usageEpoch++
    this.usage.clear()
    this.opts.emit({ kind: 'usage_recorded' })
  }

  /** 退出应用：关掉所有引擎进程 */
  async shutdown(): Promise<void> {
    this.closing = true
    for (const job of this.settlements.values()) job.abort()
    const all = [...this.runtimes.values()]
    for (const rt of all) if (rt.idleTimer) clearTimeout(rt.idleTimer)
    await Promise.all(all.map(rt => rt.session?.close().catch(() => undefined)))
  }
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
