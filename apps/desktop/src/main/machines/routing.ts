import { IPC_CONTRACT, type IpcChannelSpec } from '@pixelsky/protocol'
import { argumentMachine } from './identity'

/** What `Machines.invoke` should do with one IPC call. Pure data: no electron, no I/O. */
export type Route =
  | { kind: 'aggregate'; what: 'projects' | 'sessions' }
  | { kind: 'local' }
  | { kind: 'copyPath' }
  | { kind: 'target' }
  | { kind: 'usageExport'; machine: string }
  | { kind: 'picker' }
  | { kind: 'remote'; machine: string }

const contract: Readonly<Record<string, IpcChannelSpec>> = IPC_CONTRACT

/**
 * Decide which machine one call goes to, from the channel's IPC contract entry (route / picker / special).
 * The checks run in a fixed order; keep it. Only argument 0 is looked at (objects by sessionId / projectId / id).
 * A channel the contract does not list behaves like a plain `selected` one.
 */
export function resolveRoute(channel: string, args: unknown[], currentId: string): Route {
  const spec: Partial<IpcChannelSpec> = Object.hasOwn(contract, channel) ? contract[channel] : {}
  if (spec.route === 'aggregate')
    return { kind: 'aggregate', what: channel === 'engine:projects' ? 'projects' : 'sessions' }
  const explicit = argumentMachine(args)
  const localRef = !!args[0] && typeof args[0] === 'object' && ('projectId' in args[0] || 'sessionId' in args[0])
  const id = explicit ?? (localRef || spec.route === 'resource' ? 'local' : currentId)
  if (id === 'local' || spec.route === 'hostOnly') return { kind: 'local' }
  if (spec.special === 'copyPath') return { kind: 'copyPath' }
  if (spec.special === 'target') return { kind: 'target' }
  if (spec.special === 'usageExport') return { kind: 'usageExport', machine: id }
  if (spec.picker) return { kind: 'picker' }
  return { kind: 'remote', machine: id }
}
