import { useSyncExternalStore } from 'react'
import type { TerminalEvent, TerminalRecord, TerminalState, TerminalProfileInput } from '../../../shared/types/terminal'
import type { WorkspaceRef } from '../../../shared/types/workspace'
import { isDemo, projects } from '@/data'
import { translateMessage, tr } from '@/i18n/core'
import { demo } from '@/data/demo'

interface State extends TerminalState {
  ready: boolean
  error: string | null
}
let state: State = { profiles: [], defaultProfileId: '', terminals: [], ready: false, error: null }
const listeners = new Set<() => void>()
let init: Promise<void> | null = null
type DataEvent = Extract<TerminalEvent, { type: 'data' }>
const sinks = new Map<string, (event: DataEvent) => void>()
const pending = new Map<string, DataEvent[]>()
const recordListeners = new Set<(record: TerminalRecord) => void>()
function set(patch: Partial<State>): void {
  state = { ...state, ...patch }
  listeners.forEach(fn => fn())
}
export function terminalError(cause: unknown): void {
  set({ error: cause === null ? null : translateMessage(cause instanceof Error ? cause.message : String(cause)) })
}
export function applyTerminalRecord(record: TerminalRecord): void {
  const previous = state.terminals.find(r => r.id === record.id)
  if (previous && record.generation < previous.generation) return
  set({
    terminals: previous ? state.terminals.map(r => (r.id === record.id ? record : r)) : [...state.terminals, record],
  })
  recordListeners.forEach(fn => fn(record))
}
function event(value: TerminalEvent): void {
  if (value.type === 'record') {
    applyTerminalRecord(value.record)
    return
  }
  const sink = sinks.get(value.terminalId)
  if (sink) sink(value)
  else {
    const queue = pending.get(value.terminalId) ?? []
    queue.push(value)
    pending.set(value.terminalId, queue)
    // The host stops producing after 256 KiB until a view consumes and acknowledges it.
  }
}
export function initTerminalStore(): Promise<void> {
  return (init ??= (async () => {
    if (isDemo) {
      set({ profiles: demo().terminal.profiles, defaultProfileId: demo().terminal.profiles[0].id, ready: true })
      return
    }
    window.pixelsky?.terminal.onEvent(event)
    try {
      if (window.pixelsky) set({ ...(await window.pixelsky.terminal.state()), ready: true })
    } catch (cause) {
      set({ ready: true })
      terminalError(cause)
    }
  })())
}
export function useTerminalStore(): State {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    () => state,
  )
}
export function terminalState(): State {
  return state
}
export function onTerminalRecord(fn: (r: TerminalRecord) => void): () => void {
  recordListeners.add(fn)
  return () => {
    recordListeners.delete(fn)
  }
}
export function consumeTerminal(id: string, sink: (e: DataEvent) => void): () => void {
  sinks.set(id, sink)
  const queue = pending.get(id)
  pending.delete(id)
  queue?.forEach(sink)
  return () => {
    if (sinks.get(id) === sink) sinks.delete(id)
  }
}
export async function refreshTerminals(force = false): Promise<void> {
  if (!isDemo) set(await window.pixelsky!.terminal.state(force))
}
export async function terminalSetDefault(id: string): Promise<void> {
  if (isDemo) set({ defaultProfileId: id })
  else set(await window.pixelsky!.terminal.setDefaultProfile(id))
}
export async function terminalProfile(input: TerminalProfileInput): Promise<void> {
  if (isDemo) {
    const profile = { ...input, id: input.id ?? 'custom-' + crypto.randomUUID(), custom: true, available: true }
    set({ profiles: [...state.profiles.filter(p => p.id !== profile.id), profile] })
    return
  }
  set(await window.pixelsky!.terminal.saveProfile(input))
}
export async function removeTerminalProfile(id?: string): Promise<void> {
  if (isDemo) {
    set({
      profiles: id ? state.profiles.filter(p => p.id !== id) : demo().terminal.profiles,
      defaultProfileId: demo().terminal.profiles[0].id,
    })
    return
  }
  set(id ? await window.pixelsky!.terminal.removeProfile(id) : await window.pixelsky!.terminal.resetProfiles())
}
export async function terminalCreate(ref: WorkspaceRef, profileId?: string): Promise<TerminalRecord> {
  await initTerminalStore()
  if (isDemo) {
    if (state.terminals.length >= 12) throw new Error(tr('terminal.limit'))
    const profile = state.profiles.find(p => p.id === (profileId ?? state.defaultProfileId))!
    const project =
      projects.find(p => p.id === ref.projectId || p.sessions.some(s => s.id === ref.sessionId)) ?? projects[0]
    const record: TerminalRecord = {
      id: crypto.randomUUID(),
      projectId: project.id,
      projectName: project.name,
      cwd: project.name,
      profileId: profile.id,
      profileLabel: profile.label,
      title: profile.label,
      titleEdited: false,
      status: 'running',
      generation: 1,
      createdAt: Date.now(),
    }
    applyTerminalRecord(record)
    event({ type: 'data', terminalId: record.id, generation: 1, seq: 1, data: demo().terminal.output })
    return record
  }
  const record = await window.pixelsky!.terminal.create(ref, profileId, crypto.randomUUID())
  applyTerminalRecord(record)
  return record
}
export async function terminalRename(id: string, title: string): Promise<void> {
  const record = state.terminals.find(r => r.id === id)
  if (!record) throw new Error(tr('terminal.missing'))
  if (isDemo) applyTerminalRecord({ ...record, title, titleEdited: true })
  else applyTerminalRecord(await window.pixelsky!.terminal.rename(id, title))
}
export async function terminalClose(id: string, force = false): Promise<void> {
  if (!isDemo) await window.pixelsky!.terminal.close(id, force)
  pending.delete(id)
  set({ terminals: state.terminals.filter(r => r.id !== id) })
}
export async function terminalRestart(id: string, force = false): Promise<void> {
  const record = state.terminals.find(r => r.id === id)
  if (!record) throw new Error(tr('terminal.missing'))
  if (isDemo) {
    applyTerminalRecord({ ...record, generation: record.generation + 1, status: 'running', exitCode: undefined })
    event({ type: 'data', terminalId: id, generation: record.generation + 1, seq: 1, data: demo().terminal.output })
  } else applyTerminalRecord(await window.pixelsky!.terminal.restart(id, force))
}
export function demoWrite(id: string, data: string): void {
  const record = state.terminals.find(r => r.id === id)
  if (record) event({ type: 'data', terminalId: id, generation: record.generation, seq: Date.now(), data })
}
