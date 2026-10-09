/** Resource IDs carry machine ownership; user text, file contents and native engine IDs do not. */
export function machineOf(id: unknown): string {
  return typeof id === 'string' && /^ssh-[a-f0-9-]+~/.test(id) ? id.slice(0, id.indexOf('~')) : 'local'
}
const fields = new Set(['id', 'sessionId', 'projectId', 'itemId', 'turnId', 'queueId', 'taskId', 'terminalId', 'serviceId', 'copyId', 'parentId', 'expectedTurnId', 'fromItemId', 'userItemId', 'requestId', 'messageId', 'toolUseId', 'workspaceSessionId'])
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const opaque = new Set(['input','output','content','env','arguments','schema','metadata'])
export function remoteIds<T>(value: T, machine: string, encode: boolean, field = ''): T {
  if (opaque.has(field)) return value
  const prefix = machine + '~'
  if (typeof value === 'string') {
    if (encode) return (fields.has(field) && uuid.test(value) ? prefix + value : value) as T
    return ((!field || fields.has(field)) && value.startsWith(prefix) && uuid.test(value.slice(prefix.length)) ? value.slice(prefix.length) : value) as T
  }
  if (Array.isArray(value)) return value.map(item => remoteIds(item, machine, encode, field === 'ids' ? 'id' : field)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remoteIds(item, machine, encode, key)])) as T
  return value
}
export function argumentMachine(args: unknown[]): string | null {
  const first = args[0]
  if (typeof first === 'string' && machineOf(first) !== 'local') return machineOf(first)
  if (first && typeof first === 'object') {
    const data = first as Record<string, unknown>
    for (const key of ['sessionId', 'projectId', 'id']) if (machineOf(data[key]) !== 'local') return machineOf(data[key])
  }
  return null
}
/** Only positional resource parameters are decoded; prompt/title/path strings are user data. */
export function remoteArguments(method: string, args: unknown[], machine: string): unknown[] {
  const ids = new Set([0])
  if (/^engine:(cancelQueued|moveQueued|runQueuedNow|steerQueued|rewind|interruptTurn|answer|stopTask|taskOutput|subagentTranscript)$/.test(method)) ids.add(1)
  if (method === 'engine:steerQueued') ids.add(2)
  return args.map((arg, index) => typeof arg === 'string' ? ids.has(index) ? remoteIds(arg, machine, false) : arg : remoteIds(arg, machine, false))
}
