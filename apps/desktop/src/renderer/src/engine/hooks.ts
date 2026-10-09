import { tr } from '../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
// 给组件用的钩子：演示模式返回 mock 数据（或 undefined 让组件走演示逻辑），否则返回引擎的真实数据
import { useEffect, useMemo, useState } from 'react'
import { useEngineCatalog } from './catalog'
import { useMachines, machineOf } from '@/machines/store'
import { draftWorkspace } from '@/machines/drafts'
import { notify } from '@/panes/store'
import type { Effort, EngineId, EngineInfo, ImageAttachment, PermissionMode, QueuedMessage, QueueSettings, SessionSnapshot } from '@pixelsky/protocol'
import {
  projects as demoProjects,
  recent as demoRecent,
  runStatus as demoRunStatus,
  sessionTitle as demoTitle,
  type Project,
  type RecentItem,
  type SessionStatus,
} from '@/mock/data'
import { engineAccent, fastBlockedText, relativeTime } from './labels'
import { sidebarData, demoSidebarData, type RunStatus } from './sidebarData'
import { useDemoSessionChanges } from '@/mock/sessionLifecycle'
import { demoEngineStatus } from '@/mock/platform'
import { useAccount } from '@/account/useAccount'
import {
  getPlatformState,
  groupsForModel,
  needsBalance,
  noRouteReason,
  platformModels,
  refreshPlatform,
  resolvePlatform,
  saveDefault,
  setDefaultGroup,
  setDefaultModel,
  setDefaultSelfModel,
  setDefaultSource,
  usePlatform,
  type CreditSource,
} from '@/account/platform'
import {
  addProject,
  bridge,
  getEngineState,
  openSession,
  redetectEngines,
  refreshDefaults,
  setCurrentProject,
  setViewing,
  startEngineStore,
  useEngineState,
} from './store'

/** 是否连接了真实引擎（演示模式下为 false） */
export const isLive = !!bridge

/** 在应用启动时调用一次 */
export function useEngineBoot(): void {
  useEffect(() => startEngineStore(), [])
}

/** 当前正在看的会话（用于「有新回复」标记） */
export function useViewing(id: string | null): void {
  useEffect(() => setViewing(id), [id])
}

export function useSession(id: string | null): SessionSnapshot | null {
  const snap = useEngineState((s) => (id ? (s.snapshots[id] ?? null) : null))
  useEffect(() => {
    if (id && isLive) void openSession(id).catch(e => notify(e.message))
  }, [id, snap === null])
  return snap
}

export function useSessionTitle(id: string | null): string {
  const demoChanges=useDemoSessionChanges()
  const live = useEngineState((s) =>
    id ? (s.snapshots[id]?.record.title ?? s.sessions.find((x) => x.record.id === id)?.record.title ?? null) : null,
  )
  if (!isLive) return (id?demoChanges[id]?.title:undefined)??demoTitle(id)
  return live ?? tr("engine.hooks.message472")
}

// ---------------------------------------------------------------------------
// 侧边栏
// ---------------------------------------------------------------------------

export interface SidebarData {
  projects: Project[]
  recent: Array<RecentItem & { status?: SessionStatus }>
  runStatus: RunStatus | null
}

export function useSidebarData(): SidebarData {
  const machines = useMachines()
  const demoChanges=useDemoSessionChanges()
  const { locale } = useI18n()
  const projects = useEngineState((s) => s.projects)
  const sessions = useEngineState((s) => s.sessions)
  const unread = useEngineState((s) => s.unread)
  // 每分钟刷新一次，让「刚刚 / 5分钟」跟着变
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isLive) return
    const t = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  return useMemo(() => {
    if (!isLive) return demoSidebarData(demoProjects,demoRecent,demoRunStatus,demoChanges)
    return sidebarData(projects.filter(p => machineOf(p.id) === machines.currentId),sessions.filter(s => machineOf(s.record.id) === machines.currentId),unread,stamp=>relativeTime(stamp,now))
  }, [projects, sessions, unread, now, locale,demoChanges,machines.currentId])
}

export { addProject }

// ---------------------------------------------------------------------------
// 输入框
// ---------------------------------------------------------------------------

/**
 * 发送前就知道会失败的情况（docs/ui/source-switch.md §3.5），输入框上方显示提示条和一键按钮：
 * - signin 平台但没登录；account 会话用的平台账号和当前登录的不是同一个
 * - no-route 平台没有可用线路；balance 余额计费的线路但余额 ≤ 0（只提醒，不拦）
 * - self-auth 自有但引擎没登录；self-missing 自有但引擎不可用
 */
export type SourceBlocker =
  | { kind: 'signin' }
  | { kind: 'account'; account: string }
  | { kind: 'no-route'; message: string; balance: boolean }
  | { kind: 'balance' }
  | { kind: 'self-auth'; message: string }
  | { kind: 'self-missing'; message: string }

/** 引擎 / 额度来源 / 模型菜单用到的部分（演示模式也能提供，docs/ui/source-switch.md §3.2） */
type EngineLite = Pick<EngineInfo, 'id' | 'name' | 'status' | 'version' | 'message'>
export type SourceMenuController = Pick<
  ComposerController,
  | 'started'
  | 'source'
  | 'groupId'
  | 'model'
  | 'isDefault'
  | 'platformAvailable'
  | 'blocker'
  | 'canSwitchEngine'
  | 'selectEngine'
  | 'redetect'
  | 'setSource'
  | 'setGroup'
  | 'setModel'
  | 'saveAsDefault'
> & { engines: EngineLite[]; engine: EngineLite | null }

/** 演示模式的菜单：假目录、假引擎，选择只改内存（account/platform.ts） */
export function useDemoSourceController(): SourceMenuController {
  const platform = usePlatform()
  const isPlatform = platform.source === 'platform'
  return {
    started: false,
    source: platform.source,
    groupId: isPlatform ? platform.groupId : null,
    model: isPlatform ? platform.model : platform.selfModel,
    isDefault: true,
    platformAvailable: true,
    blocker: null,
    engines: demoEngineStatus,
    engine: demoEngineStatus[0],
    canSwitchEngine: true,
    selectEngine: () => undefined,
    redetect: () => undefined,
    setSource: async (s) => setDefaultSource(s),
    setGroup: async (id) => setDefaultGroup(id),
    setModel: async (m) => (isPlatform && m ? setDefaultModel(m) : setDefaultSelfModel(m)),
    saveAsDefault: () => undefined,
  }
}

export interface ComposerController {
  queue: QueuedMessage[]
  queuePaused: boolean
  execution: QueueSettings | null
  turnId: string | null
  steerAvailable: boolean
  state: SessionSnapshot['state']
  cancelQueued(id: string): Promise<string>
  moveQueued(id: string, index: number): Promise<void>
  runQueuedNow(id: string): Promise<void>
  steerQueued(id: string): Promise<void>
  resumeQueue(): Promise<void>
  /** 会话 id；欢迎页（还没创建会话）为 null */
  sessionId: string | null
  /** 会话已经开始（发过消息）：额度来源、线路、模型的改动只影响这个会话，不改全局默认 */
  started: boolean
  /** 当前额度来源：已开始的会话看会话记录，否则看全局默认 */
  source: CreditSource
  /** 平台线路（分组 id）；自有时为 null */
  groupId: string | null
  /** 平台：分组里的模型；自有：引擎别名或 null（跟随引擎设置） */
  model: string | null
  /** 已开始的会话的选择和全局默认一样（不一样时菜单里显示「设为默认」） */
  isDefault: boolean
  /** 平台可选（引擎是 Claude Code） */
  platformAvailable: boolean
  /** 改额度来源。已开始的会话要先在界面上确认（会重启引擎并接上原对话） */
  setSource(source: CreditSource): Promise<void>
  setGroup(groupId: string): Promise<void>
  setModel(model: string | null): Promise<void>
  saveAsDefault(): void
  blocker: SourceBlocker | null
  engines: EngineInfo[]
  engine: EngineInfo | null
  /** 还没发过消息时才能换引擎 */
  canSwitchEngine: boolean
  selectEngine(id: EngineId): void
  effort: Effort | null
  /** 当前引擎支持的强度（滑块的停靠点） */
  efforts: Effort[]
  setEffort(e: Effort): void
  /** 当前引擎有 Ultracode 开关 */
  ultracodeSupported: boolean
  /** 引擎报告当前模型能不能开；null 表示还不知道（引擎还没启动） */
  ultracodeAvailable: boolean | null
  ultracode: boolean
  setUltracode(on: boolean): void
  /** Fast 模式（更快、更贵） */
  fastSupported: boolean
  /** 能不能开；null 表示还不知道 */
  fastAvailable: boolean | null
  /** 开不了的原因（给用户看的一句话） */
  fastBlocked: string | null
  fast: boolean
  setFast(on: boolean): void
  /** 显示思考摘要 */
  thinkingSupported: boolean
  thinkingSummaries: boolean
  setThinkingSummaries(on: boolean): void
  /** 推理强度的强调色（引擎品牌色的 CSS 值）；没有品牌色时为空字符串 */
  accent: string
  /** 输入建议（输入框为空时显示，Tab 填入） */
  suggestion: string | null
  permissionMode: PermissionMode
  permissionModes: PermissionMode[]
  setPermissionMode(m: PermissionMode): void
  /** 这一轮正在进行（包括等审批） */
  running: boolean
  stop(): Promise<void>
  /** 发送；失败时抛出给用户看的错误 */
  submit(text: string, clientMessageId?: string, attachments?: ImageAttachment[]): Promise<void>
  redetect(): void
}

interface Draft {
  engine: EngineId
  effort: Effort | null
  permissionMode: PermissionMode
  ultracode: boolean
  fast: boolean
  thinkingSummaries: boolean
}

/**
 * 输入框的真实逻辑。sessionId 为 null 时是欢迎页（新会话）：设置先存在本地，
 * 发送时在当前项目里创建会话，再通过 onOpenSession 切过去。演示模式返回 undefined。
 */
export function useComposerController(
  sessionId: string | null,
  onOpenSession?: (id: string) => void,
  draftKey?: string,
): ComposerController | undefined {
  const account = useAccount()
  const engines = useEngineState((s) => s.engines)
  const defaults = useEngineState((s) => s.defaults)
  const snap = useEngineState((s) => (sessionId ? (s.snapshots[sessionId] ?? null) : null))
  const [draft, setDraft] = useState<Draft | null>(null)
  const selectedEngineId = snap?.record.engine ?? draft?.engine ?? defaults?.engine ?? 'claude'
  const platform = usePlatform(selectedEngineId)
  const catalog = useEngineCatalog(selectedEngineId)
  useEffect(() => {
    if (isLive && !sessionId) void refreshDefaults()
  }, [sessionId])

  if (!isLive || !bridge) return undefined
  const b = bridge

  const base: Draft = draft ?? {
    engine: defaults?.engine ?? 'claude',
    effort: defaults?.effort ?? 'high',
    permissionMode: defaults?.permissionMode ?? 'edits',
    ultracode: defaults?.ultracode ?? false,
    fast: defaults?.fast ?? false,
    thinkingSummaries: defaults?.thinkingSummaries ?? true,
  }
  const record = snap?.record ?? null
  const engineId = record?.engine ?? base.engine
  const engine = engines.find((e) => e.id === engineId) ?? null
  const canSwitchEngine = !record || ((snap?.items.length ?? 0) === 0 && (snap?.queue.length ?? 0) === 0 && snap?.state === 'idle')

  const patch = (p: Partial<Draft>): void => {
    if (record) void b.updateSession(record.id, p).catch(() => undefined)
    else setDraft({ ...base, ...p })
  }

  // ---- 额度来源（docs/ui/source-switch.md §3.3）：已开始的会话用自己的记录，否则用全局默认 ----
  const started = !canSwitchEngine
  const source: CreditSource = started ? (record?.platform ? 'platform' : 'self') : platform.source
  const groupId = started ? (record?.platform?.groupId ?? null) : source === 'platform' ? platform.groupId : null
  const model = started ? (record?.model ?? null) : source === 'platform' ? platform.model : platform.selfModel
  const isDefault =
    source === platform.source && (source === 'platform' ? groupId === platform.groupId && model === platform.model : model === platform.selfModel)
  const platformAvailable = true
  /** 平台模型切到自有时：完整的 Claude 模型名本机也认，其他（别的厂商）换回引擎默认 */
  const selfModelFrom = (m: string | null): string | null => (m && (engineId === 'codex' ? catalog?.models?.some(model => model.id === m) : /^claude-/.test(m)) ? m : null)

  let blocker: SourceBlocker | null = null
  if (source === 'platform') {
    const group = platform.groups.find((g) => g.id === groupId)
    const balance = account.account?.balance ?? null
    if (!platform.email) blocker = { kind: 'signin' }
    else if (started && record?.platform && record.platform.account !== platform.email) blocker = { kind: 'account', account: record.platform.account }
    else if (!started && platform.loaded && !platform.loading && (!groupId || !model))
      blocker = { kind: 'no-route', ...noRouteReason(platform, balance), ...(engineId==='codex'&&platform.groups.length===0?{message:tr('codex.noRoutes')}: {}) }
    else if (needsBalance(group) && balance !== null && balance <= 0) blocker = { kind: 'balance' }
  } else if (engine && engine.status === 'unauthenticated') {
    blocker = { kind: 'self-auth', message: engine.message ?? tr("engine.hooks.message473", { p0: engine.name }) }
  } else if (engine && engine.status !== 'ready') {
    blocker = { kind: 'self-missing', message: engine.message ?? tr("engine.hooks.message474", { p0: engine.name }) }
  }

  /** 平台的（分组，模型）：优先保住 want 这个模型，否则沿用全局默认 */
  const platformPick = async (want: string | null): Promise<{ groupId: string; model: string }> => {
    // 目录还没读过（比如从提示条直接改用平台）：先读一次再挑线路
    if (!getPlatformState(engineId).loaded) await refreshPlatform()
    const p = getPlatformState(engineId)
    const models = platformModels(p.groups)
    const sel = resolvePlatform(p.groups, groupId ?? p.groupId, want && models.includes(want) ? want : p.model)
    if (!sel.groupId || !sel.model) throw new Error(noRouteReason(p, account.account?.balance ?? null).message)
    return { groupId: sel.groupId, model: sel.model }
  }

  const setSource = async (next: CreditSource): Promise<void> => {
    if (!started || !record) {
      setDefaultSource(next, engineId)
      return
    }
    if (next === source) return
    if (next === 'self') {
      await b.updateSession(record.id, { platform: null, model: selfModelFrom(record.model) })
      return
    }
    if (!platform.email) throw new Error(tr("engine.hooks.message475"))
    const pick = await platformPick(record.model)
    await b.updateSession(record.id, { platform: { groupId: pick.groupId, account: platform.email }, model: pick.model })
  }

  const setGroup = async (id: string): Promise<void> => {
    if (!started || !record) {
      setDefaultGroup(id, engineId)
      return
    }
    const group = platform.groups.find((g) => g.id === id)
    if (!record.platform || !group || group.models.length === 0) return
    const m = record.model && group.models.includes(record.model) ? record.model : group.models[0]
    await b.updateSession(record.id, { platform: { groupId: id, account: record.platform.account }, model: m })
  }

  const setModel = async (m: string | null): Promise<void> => {
    const selected = catalog?.models?.find(model => model.id === (m ?? catalog.currentModel))
    const previousEffort = record?.effort ?? base.effort
    const effort = selected && previousEffort && !selected.efforts.includes(previousEffort) ? selected.defaultEffort : previousEffort
    const effortPatch = effort !== previousEffort ? { effort } : {}
    if (!started || !record) {
      if (source === 'platform' && m) setDefaultModel(m, engineId)
      else setDefaultSelfModel(m, engineId)
      if (effort !== previousEffort) patch(effortPatch)
      return
    }
    if (!record.platform) {
      await b.updateSession(record.id, { model: m, ...effortPatch })
      return
    }
    if (!m) return
    // 先保模型：当前线路没有这个模型就换到包含它、倍率最低的线路
    const keep = platform.groups.find((g) => g.id === record.platform?.groupId)?.models.includes(m)
    const route = keep ? record.platform.groupId : groupsForModel(platform.groups, m)[0]?.id
    if (!route) throw new Error(tr("engine.hooks.message476"))
    await b.updateSession(record.id, { platform: { groupId: route, account: record.platform.account }, model: m, ...effortPatch })
  }

  return {
    sessionId: record?.id ?? null,
    queue: snap?.queue ?? [],
    queuePaused: snap?.queuePaused ?? false,
    execution: snap?.execution ?? null,
    turnId: snap?.turnId ?? null,
    steerAvailable: snap?.flags.steerAvailable === true,
    state: snap?.state ?? 'idle',
    cancelQueued: (id) => record ? b.cancelQueued(record.id, id) : Promise.reject(new Error(tr("engine.hooks.message477"))),
    moveQueued: (id, index) => record ? b.moveQueued(record.id, id, index) : Promise.reject(new Error(tr("engine.hooks.message477"))),
    runQueuedNow: (id) => record ? b.runQueuedNow(record.id, id) : Promise.reject(new Error(tr("engine.hooks.message477"))),
    steerQueued: (id) => record && snap?.turnId ? b.steerQueued(record.id, id, snap.turnId) : Promise.reject(new Error(tr("engine.hooks.message478"))),
    resumeQueue: () => record ? b.resumeQueue(record.id) : Promise.reject(new Error(tr("engine.hooks.message477"))),
    started,
    source,
    groupId,
    model,
    isDefault,
    platformAvailable,
    setSource,
    setGroup,
    setModel,
    saveAsDefault: () => {
      if (source === 'platform') saveDefault({ source, groupId, model }, engineId)
      else saveDefault({ source, selfModel: model }, engineId)
    },
    blocker,
    engines,
    engine,
    canSwitchEngine,
    selectEngine: (id) => {
      if (canSwitchEngine) patch({ engine: id, effort: 'high', ultracode: false, fast: false, thinkingSummaries: true })
    },
    effort: record ? record.effort : base.effort,
    efforts: catalog?.models?.find(m => m.id === (model ?? catalog.currentModel))?.efforts ?? engine?.caps.efforts ?? ['low', 'medium', 'high', 'xhigh', 'max'],
    setEffort: (effort) => patch({ effort }),
    ultracodeSupported: engine?.caps.ultracode ?? false,
    ultracodeAvailable: snap?.flags.ultracodeAvailable ?? null,
    ultracode: record ? record.ultracode : base.ultracode,
    setUltracode: (ultracode) => patch({ ultracode }),
    fastSupported: engine?.caps.fast ?? false,
    fastAvailable: snap?.flags.fastAvailable ?? null,
    fastBlocked: snap?.flags.fastBlocked && snap.flags.fastAvailable === false ? fastBlockedText(snap.flags.fastBlocked) : null,
    fast: record ? record.fast : base.fast,
    setFast: (fast) => patch({ fast }),
    thinkingSupported: engine?.caps.thinkingSummaries ?? false,
    thinkingSummaries: record ? record.thinkingSummaries : base.thinkingSummaries,
    setThinkingSummaries: (thinkingSummaries) => patch({ thinkingSummaries }),
    accent: engineAccent(engineId),
    suggestion: snap?.suggestion ?? null,
    permissionMode: record ? record.permissionMode : base.permissionMode,
    permissionModes: engine?.caps.permissionModes ?? ['ask', 'edits', 'plan', 'full'],
    setPermissionMode: (permissionMode) => patch({ permissionMode }),
    running: !!snap && snap.state !== 'idle',
    stop: () => record ? b.interrupt(record.id) : Promise.resolve(),
    redetect: () => void redetectEngines(),
    submit: async (text, clientMessageId = crypto.randomUUID(), attachments = []) => {
      if (attachments.length && (engine ?? (await b.engines()).find(info => info.id === engineId))?.caps.imageInput !== true) throw new Error(tr('composer.attachment.unsupportedEngine'))
      // 平台失败不改用自有（D023）：拦下来让用户自己选
      if (blocker?.kind === 'signin') throw new Error(tr("engine.hooks.message479"))
      if (blocker?.kind === 'account') throw new Error(tr("engine.hooks.message480", { p0: blocker.account }))
      if (blocker?.kind === 'no-route') throw new Error(blocker.message)
      const usePlatform = source === 'platform'
      if (record && started) {
        await b.send(record.id, { text, clientMessageId, attachments })
        return
      }
      if (usePlatform && (platform.loading || !groupId || !model)) throw new Error(platform.error ?? tr("engine.hooks.message481"))
      const sourcePatch = usePlatform
        ? { platform: { groupId: groupId!, account: platform.email! }, model, engine: engineId }
        : { platform: null, model }
      if (record) {
        await b.updateSession(record.id, sourcePatch)
        await b.send(record.id, { text, clientMessageId, attachments })
        return
      }
      // 欢迎页：先确认引擎可用、有项目，再创建会话
      const info = engine ?? (await b.engines()).find((e) => e.id === engineId)
      if (info && info.status !== 'ready' && !(usePlatform && info.status === 'unauthenticated')) throw new Error(info.message ?? tr("session.ModelSourceMenu.message315", { p0: info.name }))
      const workspace = draftKey ? draftWorkspace(draftKey) : null
      const projectId = workspace?.projectId ?? getEngineState().currentProjectId ?? (await addProject())
      if (!projectId) throw new Error(tr("engine.hooks.message482"))
      const created = await b.createSession({ projectId, copyId: workspace?.copyId, workspaceSessionId: workspace?.sessionId, ...base, ...sourcePatch })
      try {
        await b.send(created.id, { text, clientMessageId, attachments })
      } catch (err) {
        await b.deleteSession(created.id).catch(() => undefined)
        throw err
      }
      setDraft(null)
      onOpenSession?.(created.id)
    },
  }
}

// ---------------------------------------------------------------------------
// 输入框下方状态栏
// ---------------------------------------------------------------------------

export interface StatusBarController {
  project: { id: string; name: string; path: string } | null
  projects: Array<{ id: string; name: string; path: string }>
  /** 欢迎页才能换项目 */
  canPickProject: boolean
  selectProject(id: string): void
  addProject(): void
}

export function useStatusBar(sessionId: string | null, draftKey?: string): StatusBarController | undefined {
  const projects = useEngineState((s) => s.projects)
  const currentProjectId = useEngineState((s) => s.currentProjectId)
  const snap = useEngineState((s) => (sessionId ? (s.snapshots[sessionId] ?? null) : null))
  if (!isLive) return undefined
  const chosen = draftKey ? draftWorkspace(draftKey) : null
  const pid = chosen?.projectId ?? snap?.record.projectId ?? (sessionId ? null : currentProjectId)
  const project = projects.find((p) => p.id === pid) ?? null
  return {
    project: chosen ? { id: chosen.projectId, name: chosen.name, path: chosen.path } : project
      ? { id: project.id, name: snap && snap.record.cwd.toLowerCase() !== project.path.toLowerCase() ? project.name + ' / ' + (snap.record.cwd.split(/[\\/]/).pop() || '') : project.name, path: snap?.record.cwd ?? project.path }
      : snap
        ? { id: snap.record.projectId, name: snap.record.cwd.split(/[\\/]/).pop() || snap.record.cwd, path: snap.record.cwd }
        : null,
    projects,
    canPickProject: !sessionId,
    selectProject: setCurrentProject,
    addProject: () => void addProject(),
  }
}
