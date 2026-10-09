import { useSyncExternalStore } from 'react'
import type { MachineState, WorkspaceChoice } from '../../../preload/machines'
import { getEngineState, setCurrentProject, refreshMachineEngine, invalidateRemoteSnapshots } from '@/engine/store'
import { paneActions } from '@/panes/store'
import { refreshTerminals } from '@/terminal/store'
import { isDemo } from '@/mock/data'
import { isNewTab } from '@/panes/tree'

export const machineOf = (id: unknown): string =>
  typeof id === 'string' && /^ssh-[a-f0-9-]+~/.test(id) ? id.slice(0, id.indexOf('~')) : 'local'
const listeners = new Set<() => void>()
let state: MachineState = {
  currentId: 'local',
  machines: [
    {
      id: 'local',
      name: '',
      host: '',
      port: 0,
      username: '',
      auth: 'local',
      hasSecret: false,
      status: 'local',
      error: null,
      fingerprint: null,
      platform: window.pixelsky?.platform ?? null,
      home: null,
    },
  ],
}
let started = false,
  switching = false
export function useMachines(): MachineState {
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
export const getMachines = (): MachineState => state
const set = (value: MachineState) => {
  const reconnected = value.machines.filter(
    m => m.status === 'connected' && state.machines.find(old => old.id === m.id)?.status !== 'connected',
  )
  state = value
  listeners.forEach(fn => fn())
  for (const machine of reconnected) {
    invalidateRemoteSnapshots(machine.id)
    if (machine.id === state.currentId) void refreshMachineEngine(machine.id).catch(() => {})
  }
}
export async function initMachines(): Promise<void> {
  if (started || isDemo || !window.pixelsky) return
  started = true
  window.pixelsky.machines.onChange(set)
  set(await window.pixelsky.machines.state())
}
export function openMachineManager(): void {
  window.dispatchEvent(new Event('pixelsky:manage-machines'))
}
export function openWorkspacePicker(): void {
  window.dispatchEvent(new Event('pixelsky:choose-workspace'))
}
export async function selectMachine(id: string): Promise<void> {
  if (switching || id === state.currentId) return
  switching = true
  const previous = state.currentId
  try {
    if (isDemo) return
    await window.pixelsky!.machines.select(id)
    set(await window.pixelsky!.machines.state())
    await refreshMachineEngine(id)
    paneActions.switchMachine(id)
    const sessions = new Set(getEngineState().sessions.map(s => s.record.id))
    paneActions.prune(tab => isNewTab(tab) || sessions.has(tab))
    await refreshTerminals()
  } catch (error) {
    await window.pixelsky!.machines.select(previous).catch(() => {})
    set(await window.pixelsky!.machines.state())
    await refreshMachineEngine(previous).catch(() => {})
    throw error
  } finally {
    switching = false
  }
}
export async function selectWorkspace(choice: WorkspaceChoice): Promise<void> {
  const id = machineOf(choice.projectId)
  if (id !== state.currentId) await selectMachine(id)
  setCurrentProject(choice.projectId)
  const existing = getEngineState().sessions.find(
    s =>
      s.record.projectId === choice.projectId &&
      s.record.cwd.replaceAll('\\', '/') === choice.path.replaceAll('\\', '/') &&
      !s.record.archivedAt,
  )
  const record = existing?.record ?? (await window.pixelsky!.machines.openWorkspace(choice))
  paneActions.open(record.id)
  try {
    localStorage.setItem('pixelsky.last-workspace.' + id, JSON.stringify(choice))
  } catch {}
}
