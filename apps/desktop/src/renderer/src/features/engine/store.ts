// 引擎系统在界面这边的数据：引擎状态、项目、会话列表、打开过的会话快照。
// 数据来自主进程（window.pixelsky.engine），事件用 @pixelsky/protocol 的 reduce() 折叠，和主进程结果一致。
// 演示模式（--demo）不连接引擎：会话快照一开始装着演示的对话展示（docs/ui/demo-conversation.md），其余一直是空的，界面照旧显示 mock/demo.ts。
import { useSyncExternalStore } from 'react'
import {
  reduce,
  type EngineConfig,
  type EngineDefaults,
  type EngineInfo,
  type HostEvent,
  type ProjectRecord,
  type SessionSnapshot,
  type SessionSummary,
} from '@pixelsky/protocol'
import { isDemo } from '@/data'
import { demo } from '@/data/demo'
import { SESSION_REMOVED_EVENT } from './sessionLifecycle'
import { getMachines, machineOf } from '@/features/machines/store'

export interface EngineState {
  /** 已经从主进程拿到初始数据 */
  ready: boolean
  engines: EngineInfo[]
  defaults: EngineDefaults | null
  /** 各引擎的本机配置（设置 › 本机引擎）；输入框的引擎菜单按 hidden 过滤 */
  config: EngineConfig | null
  projects: ProjectRecord[]
  sessions: SessionSummary[]
  /** 打开过的会话快照 */
  snapshots: Record<string, SessionSnapshot>
  /** 有新回复、还没看的会话 */
  unread: Record<string, true>
  /** 欢迎页（新会话）要在哪个项目里开始 */
  currentProjectId: string | null
}

let state: EngineState = {
  ready: false,
  engines: [],
  defaults: null,
  config: null,
  projects: [],
  sessions: [],
  snapshots: isDemo ? { ...demo().conversations.snapshots } : {},
  unread: {},
  currentProjectId: null,
}
const listeners = new Set<() => void>()
/** 每个会话已应用到的事件序号 */
const seqs: Record<string, number> = {}
/** 正在打开（等快照）的会话：期间到达的事件先存起来 */
const opening: Record<string, Array<{ seq: number; event: HostEvent & { kind: 'session' } }>> = {}
/** 用户正在看的会话（它的新回复不算未读） */
// 正在显示的会话（多窗格时每个窗格一个），这些会话回复完不标「新回复」
let viewing = new Set<string>()

export const bridge = isDemo ? undefined : window.pixelsky?.engine

function set(patch: Partial<EngineState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

// 演示模式里会动的会话（压缩上下文循环播放）
if (isDemo)
  demo().conversations.animate?.((id, change) => {
    const snap = state.snapshots[id]
    if (snap) set({ snapshots: { ...state.snapshots, [id]: { ...snap, items: change(snap.items) } } })
  })

export function getEngineState(): EngineState {
  return state
}

export function useEngineState<T>(selector: (s: EngineState) => T): T {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => selector(state),
  )
}

/** 默认项目：最近用过的会话所在的项目，没有就用第一个 */
function pickProject(projects: ProjectRecord[], sessions: SessionSummary[], current: string | null): string | null {
  projects = projects.filter(p => machineOf(p.id) === getMachines().currentId)
  if (current && projects.some(p => p.id === current)) return current
  const recent = sessions.find(s => projects.some(p => p.id === s.record.projectId))
  return recent?.record.projectId ?? projects[0]?.id ?? null
}

function applySessionEvent(e: HostEvent & { kind: 'session' }): void {
  const id = e.sessionId
  if (opening[id]) {
    opening[id].push({ seq: e.seq, event: e })
    return
  }
  const snap = state.snapshots[id]
  if (!snap || e.seq <= (seqs[id] ?? 0)) return
  seqs[id] = e.seq
  const next = reduce(snap, e.event)
  const unread =
    e.event.type === 'turn_completed' && !viewing.has(id) ? { ...state.unread, [id]: true as const } : state.unread
  set({ snapshots: { ...state.snapshots, [id]: next }, unread })
}

function onHostEvent(e: HostEvent): void {
  switch (e.kind) {
    case 'session':
      applySessionEvent(e)
      return
    case 'sessions': {
      const ids = new Set(e.sessions.map(s => s.record.id)),
        archived = new Set(
          e.sessions
            .filter(
              s => s.record.archivedAt && !state.sessions.find(old => old.record.id === s.record.id)?.record.archivedAt,
            )
            .map(s => s.record.id),
        )
      const removed = state.sessions.filter(s => !ids.has(s.record.id)).map(s => s.record.id),
        snapshots = { ...state.snapshots },
        unread = { ...state.unread }
      for (const id of removed) {
        delete snapshots[id]
        delete unread[id]
        delete seqs[id]
      }
      for (const id of archived) delete unread[id]
      set({
        sessions: e.sessions,
        snapshots,
        unread,
        currentProjectId: pickProject(state.projects, e.sessions, state.currentProjectId),
      })
      if (removed.length || archived.size)
        window.dispatchEvent(new CustomEvent(SESSION_REMOVED_EVENT, { detail: { ids: [...removed, ...archived] } }))
      return
    }
    case 'projects':
      set({ projects: e.projects, currentProjectId: pickProject(e.projects, state.sessions, state.currentProjectId) })
      return
    case 'engines':
      set({ engines: e.engines })
      return
    case 'engine_config':
      // 默认引擎、新会话默认值可能跟着变了
      set({ config: e.config })
      void refreshDefaults()
      return
  }
}

let started = false

/** 连接主进程：拉初始数据、订阅事件（只做一次） */
export function startEngineStore(): void {
  if (started || !bridge) return
  started = true
  bridge.onEvent(onHostEvent)
  void Promise.all([bridge.projects(), bridge.sessions(), bridge.defaults()]).then(([projects, sessions, defaults]) => {
    set({ ready: true, projects, sessions, defaults, currentProjectId: pickProject(projects, sessions, null) })
  })
  void bridge.engines().then(engines => set({ engines }))
  void bridge.config().then(config => set({ config }))
}

/** 确保会话快照已加载 */
export async function openSession(id: string): Promise<void> {
  if (!bridge || state.snapshots[id] || opening[id]) return
  opening[id] = []
  try {
    const { snapshot, seq } = await bridge.openSession(id)
    if (state.ready && !state.sessions.some(s => s.record.id === id)) return
    let snap = snapshot
    let last = seq
    for (const b of opening[id]) {
      if (b.seq > last) {
        snap = reduce(snap, b.event.event)
        last = b.seq
      }
    }
    seqs[id] = last
    set({ snapshots: { ...state.snapshots, [id]: snap } })
  } catch (error) {
    if (!state.ready || state.sessions.some(s => s.record.id === id)) throw error
  } finally {
    delete opening[id]
  }
}

/** 切换正在看的会话，清掉它的「新回复」标记 */
export function setViewing(id: string | null): void {
  setViewingSet(id ? [id] : [])
}

/** 这个会话现在是否显示在某个窗格里（通知判断用，docs/ui/notifications.md） */
export const isViewingSession = (id: string): boolean => viewing.has(id)

/** 多窗格：所有窗格里正在显示的会话（docs/ui/multi-pane.md §5） */
export function setViewingSet(ids: string[]): void {
  viewing = new Set(ids)
  if (ids.some(id => state.unread[id])) {
    const rest = { ...state.unread }
    for (const id of ids) delete rest[id]
    set({ unread: rest })
  }
}

/** 重新拉取新会话默认设置（用户在别的会话里改过强度 / 权限后，新会话沿用） */
export async function refreshDefaults(): Promise<void> {
  if (!bridge) return
  const machine = getMachines().currentId,
    defaults = await bridge.defaults()
  if (getMachines().currentId === machine) set({ defaults })
}

export function setCurrentProject(id: string): void {
  set({ currentProjectId: id })
}
export async function refreshMachineEngine(machine: string): Promise<void> {
  if (!bridge) return
  const [projects, sessions, defaults, engines, config] = await Promise.all([
    bridge.projects(),
    bridge.sessions(),
    bridge.defaults(),
    bridge.engines(),
    bridge.config(),
  ])
  if (getMachines().currentId !== machine) return
  let current: string | null = null
  try {
    current = JSON.parse(localStorage.getItem('pixelsky.last-workspace.' + machine) ?? 'null')?.projectId ?? null
  } catch {}
  const allowed = projects.filter(p => machineOf(p.id) === machine)
  set({ projects, sessions, defaults, engines, config, currentProjectId: pickProject(allowed, sessions, current) })
  window.dispatchEvent(new Event('pixelsky:machine-context'))
}
export function invalidateRemoteSnapshots(machine: string): void {
  const snapshots = { ...state.snapshots }
  for (const id of Object.keys(snapshots))
    if (machineOf(id) === machine) {
      delete snapshots[id]
      delete seqs[id]
    }
  set({ snapshots })
}

/** 重新检测引擎（用户装好 / 登录之后） */
export async function redetectEngines(): Promise<void> {
  if (!bridge) return
  set({ engines: await bridge.engines(true) })
}

/** 添加项目；成功后设为当前项目 */
export async function addProject(): Promise<string | null> {
  if (!bridge) return null
  if (getMachines().currentId !== 'local') {
    window.dispatchEvent(new Event('pixelsky:choose-workspace'))
    return null
  }
  const p = await bridge.addProject()
  if (!p) return null
  const projects = state.projects.some(x => x.id === p.id) ? state.projects : [...state.projects, p]
  set({ projects, currentProjectId: p.id })
  return p.id
}

/** 改项目显示名；列表随宿主的 projects 事件刷新 */
export async function renameProject(id: string, name: string): Promise<void> {
  if (!bridge) return
  await bridge.renameProject(id, name)
}

/** 从列表移除项目；磁盘文件和会话记录保留 */
export async function removeProject(id: string): Promise<void> {
  if (!bridge) return
  await bridge.removeProject(id)
}
