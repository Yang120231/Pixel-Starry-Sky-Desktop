// 界面用的数据钩子：电脑列表、某台电脑的任务和项目、某个会话。只经 connection/ 拿数据。
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { EngineEvent, HostEvent, Item, ProjectRecord, SessionSummary } from '@pixelsky/protocol'
import { connections, type DesktopLink, type LinkState, type Pairing } from '@/connection'
import { applyEvent, applyTail, emptyView, prependOlder, replaceItem, type SessionView, type Tail } from './session'

/** 配对过的电脑和当前选中的那台；连接状态变化时刷新 */
export function useConnections(): { list: Pairing[]; active: Pairing | null } {
  useSyncExternalStore(
    l => connections.subscribe(l),
    () => connections.snapshot(),
  )
  return { list: connections.list(), active: connections.active() }
}

export function useLinkState(deviceId: string | undefined): LinkState | undefined {
  useSyncExternalStore(
    l => connections.subscribe(l),
    () => connections.snapshot(),
  )
  return deviceId ? connections.state(deviceId) : undefined
}

/** 收这台电脑推来的事件 */
function useEvents(deviceId: string | undefined, handler: (event: HostEvent) => void): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!deviceId) return
    const listener = (id: string, event: unknown) => {
      if (id === deviceId) ref.current(event as HostEvent)
    }
    connections.eventListeners.add(listener)
    return () => {
      connections.eventListeners.delete(listener)
    }
  }, [deviceId])
}

export interface DesktopData {
  link: DesktopLink | undefined
  state: LinkState | undefined
  sessions: SessionSummary[]
  projects: ProjectRecord[]
  loaded: boolean
}

/** 一台电脑的任务列表和项目：连上时拉一次，之后跟着推送更新 */
export function useDesktop(deviceId: string | undefined): DesktopData {
  const state = useLinkState(deviceId)
  const link = deviceId ? connections.link(deviceId) : undefined
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (state !== 'ready' || !link) return
    let alive = true
    void Promise.all([
      link.call<SessionSummary[]>('engine:sessions'),
      link.call<ProjectRecord[]>('engine:projects'),
    ]).then(
      ([s, p]) => {
        if (!alive) return
        setSessions(s)
        setProjects(p)
        setLoaded(true)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [state, link])
  useEvents(deviceId, event => {
    if (event.kind === 'sessions') setSessions(event.sessions)
    else if (event.kind === 'projects') setProjects(event.projects)
  })
  return { link, state, sessions, projects, loaded }
}

export interface SessionData {
  view: SessionView
  error: string | null
  loadOlder(): Promise<void>
  detail(itemId: string): Promise<void>
}

/** 一个会话：连上（或重连）时取尾部快照，之后按 seq 应用事件；seq 接不上就重新取 */
export function useSession(deviceId: string, sessionId: string): SessionData {
  const state = useLinkState(deviceId)
  const link = connections.link(deviceId)
  const [view, setView] = useState<SessionView>(emptyView)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (state !== 'ready' || !link) return
    let alive = true
    setView(v => ({ ...emptyView(), buffer: v.snapshot ? [] : v.buffer }))
    link.call<Tail>('engine:openSessionTail', sessionId).then(
      tail => alive && setView(v => applyTail(v, tail)),
      (e: Error) => alive && setError(e.message),
    )
    return () => {
      alive = false
      link.call('unwatch', sessionId).catch(() => undefined)
    }
  }, [state, link, sessionId, reload])

  useEvents(deviceId, event => {
    if (event.kind !== 'session' || event.sessionId !== sessionId) return
    setView(v => applyEvent(v, event.seq, event.event as EngineEvent))
  })

  useEffect(() => {
    if (view.stale) setReload(n => n + 1)
  }, [view.stale])

  const loadOlder = useCallback(async () => {
    if (!link || !view.before) return
    const older = await link.call<Tail>('engine:openSessionTail', sessionId, { before: view.before })
    setView(v => prependOlder(v, older))
  }, [link, sessionId, view.before])

  const detail = useCallback(
    async (itemId: string) => {
      if (!link) return
      const r = await link.call<{ item: Item; truncated: boolean } | null>('engine:itemDetail', sessionId, itemId)
      if (r) setView(v => replaceItem(v, r.item, r.truncated))
    },
    [link, sessionId],
  )

  return { view, error, loadOlder, detail }
}
