// 每台电脑的会话列表和项目：全应用一份（抽屉、概览、会话页共用，docs/mobile-remote.md §18.3），
// 连上 / 重连时取一次，之后跟着电脑推来的事件更新。
import type { HostEvent, ProjectRecord, SessionSummary } from '@pixelsky/protocol'
import { connections, type LinkState } from '@/connection'

export interface DesktopLists {
  sessions: SessionSummary[]
  projects: ProjectRecord[]
  loaded: boolean
}

export const NO_LISTS: DesktopLists = { sessions: [], projects: [], loaded: false }

class Lists {
  private readonly data = new Map<string, DesktopLists>()
  private readonly states = new Map<string, LinkState | undefined>()
  private readonly listeners = new Set<() => void>()
  private started = false

  get(deviceId: string): DesktopLists {
    return this.data.get(deviceId) ?? NO_LISTS
  }

  subscribe(listener: () => void): () => void {
    this.start()
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 重新取（「工作区」的刷新按钮） */
  async refresh(deviceId: string): Promise<void> {
    const link = connections.link(deviceId)
    if (!link || connections.state(deviceId) !== 'ready') return
    const [sessions, projects] = await Promise.all([
      link.call<SessionSummary[]>('engine:sessions'),
      link.call<ProjectRecord[]>('engine:projects'),
    ])
    this.set(deviceId, { sessions, projects, loaded: true })
  }

  private set(deviceId: string, patch: Partial<DesktopLists>): void {
    this.data.set(deviceId, { ...this.get(deviceId), ...patch })
    for (const l of this.listeners) l()
  }

  private start(): void {
    if (this.started) return
    this.started = true
    connections.subscribe(() => this.check())
    connections.eventListeners.add((deviceId, data) => {
      const event = data as HostEvent
      if (event?.kind === 'sessions') this.set(deviceId, { sessions: event.sessions })
      else if (event?.kind === 'projects') this.set(deviceId, { projects: event.projects })
    })
    this.check()
  }

  /** 变成「已连接」时取一次（断开期间漏掉的推送靠这一次补上） */
  private check(): void {
    for (const p of connections.list()) {
      const state = connections.state(p.deviceId)
      const before = this.states.get(p.deviceId)
      this.states.set(p.deviceId, state)
      if (state === 'ready' && before !== 'ready') void this.refresh(p.deviceId).catch(() => undefined)
    }
  }
}

export const desktopLists = new Lists()
