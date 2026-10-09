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

/** Channels that always run on this computer, whichever machine is selected. */
const hostOnly = [
  'files:finishClose',
  'terminal:clipboardRead',
  'terminal:clipboardWrite',
  'terminal:openLink',
  'projectTools:openExternal',
]
/** Channels that need a native folder / file picker, which cannot run for a remote machine. */
const picker = [
  'files:reveal',
  'editor:open',
  'projectTools:openPath',
  'projectTools:revealCopy',
  'projectTools:chooseDirectory',
  'engine:addProject',
]
/** Channels whose parameters name a resource: without a remote id they stay on this computer. */
const resourceChannel =
  /^(engine:(openSession|send|context|compact|cancelQueued|moveQueued|runQueuedNow|steerQueued|resumeQueue|rewind|interrupt|interruptTurn|answer|updateSession|deleteSession|renameSession|archiveSession|setSessionBottom|stopTask|taskOutput|subagentTranscript|removeProject|renameProject)|projectTools:(tasks|createTask|updateTask|deleteTask|reorderTasks|copies|branches|previewCopy|createCopy|openCopy|removeCopy|forgetCopy|deleteService|startService|stopService|restartService|revealCopy))$/

/** Decide which machine one call goes to. The checks run in a fixed order; keep it. */
export function resolveRoute(channel: string, args: unknown[], currentId: string): Route {
  if (channel === 'engine:projects') return { kind: 'aggregate', what: 'projects' }
  if (channel === 'engine:sessions') return { kind: 'aggregate', what: 'sessions' }
  const explicit = argumentMachine(args)
  const localRef = !!args[0] && typeof args[0] === 'object' && ('projectId' in args[0] || 'sessionId' in args[0])
  const resource = resourceChannel.test(channel)
  const id = explicit ?? (localRef || resource ? 'local' : currentId)
  if (id === 'local' || hostOnly.includes(channel)) return { kind: 'local' }
  if (channel === 'files:copyPath') return { kind: 'copyPath' }
  if (channel === 'files:target') return { kind: 'target' }
  if (channel === 'engine:usageExport') return { kind: 'usageExport', machine: id }
  if (picker.includes(channel)) return { kind: 'picker' }
  return { kind: 'remote', machine: id }
}
