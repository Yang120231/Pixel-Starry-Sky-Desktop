import { IPC_CONTRACT, type IpcChannelSpec } from '@pixelsky/protocol'

/** Resource IDs carry machine ownership; user text, file contents and native engine IDs do not. */
export function machineOf(id: unknown): string {
  return typeof id === 'string' && /^(ssh|wsl)-[a-f0-9-]+~/.test(id) ? id.slice(0, id.indexOf('~')) : 'local'
}
const fields = new Set([
  'id',
  'sessionId',
  'projectId',
  'itemId',
  'turnId',
  'queueId',
  'taskId',
  'terminalId',
  'serviceId',
  'copyId',
  'parentId',
  'expectedTurnId',
  'fromItemId',
  'userItemId',
  'requestId',
  'messageId',
  'toolUseId',
  'workspaceSessionId',
  // 定时任务开出的会话指向来源任务（docs/ui/board-schedule.md）
  'scheduleTaskId',
  // 分支会话 record.branch.startAfter 指向快照里的条目 id（条目 id 会加前缀，它也要跟着加，分隔线才对得上）
  'startAfter',
  // 原生 Claude / Codex 会话已经属于哪个像素星空对话（engine/host/native.ts）：续接选择器按它打开那个对话
  'ownerId',
])
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const resourceId = /^(ssh|wsl)-[a-f0-9-]+~[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const opaque = new Set(['input', 'output', 'content', 'env', 'arguments', 'schema', 'metadata'])
export function remoteIds<T>(value: T, machine: string, encode: boolean, field = ''): T {
  if (opaque.has(field)) return value
  const prefix = machine + '~'
  if (typeof value === 'string') {
    if (encode) return (fields.has(field) && uuid.test(value) ? prefix + value : value) as T
    return (
      (!field || fields.has(field)) && value.startsWith(prefix) && uuid.test(value.slice(prefix.length))
        ? value.slice(prefix.length)
        : value
    ) as T
  }
  if (Array.isArray(value))
    return value.map(item => remoteIds(item, machine, encode, field === 'ids' ? 'id' : field)) as T
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, remoteIds(item, machine, encode, key)]),
    ) as T
  return value
}
export function argumentMachine(args: unknown[]): string | null {
  const first = args[0]
  // 字符串首参数只有是完整「机器前缀~uuid」才算资源 ID，避免搜索文字之类被误路由
  if (typeof first === 'string' && resourceId.test(first)) return machineOf(first)
  if (first && typeof first === 'object') {
    const data = first as Record<string, unknown>
    for (const key of ['sessionId', 'projectId', 'id'])
      if (machineOf(data[key]) !== 'local') return machineOf(data[key])
  }
  return null
}
const contract: Readonly<Record<string, IpcChannelSpec>> = IPC_CONTRACT
/** Which argument positions of each remote method hold resource IDs, read from the IPC contract. */
const idPositions = new Map<string, readonly number[]>()
for (const spec of Object.values(contract)) if (spec.remote && spec.ids) idPositions.set(spec.remote, spec.ids)
/** The remote helper method that serves a channel (`machines:workspaces` -> `workspaces`); channels without one keep their own name. */
export function remoteMethod(channel: string): string {
  return (Object.hasOwn(contract, channel) ? contract[channel].remote : undefined) ?? channel
}
/** Only positional resource parameters are decoded; prompt/title/path strings are user data. */
export function remoteArguments(method: string, args: unknown[], machine: string): unknown[] {
  // Methods the contract does not list decode the first parameter only.
  const ids = new Set(idPositions.get(method) ?? [0])
  return args.map((arg, index) =>
    typeof arg === 'string' ? (ids.has(index) ? remoteIds(arg, machine, false) : arg) : remoteIds(arg, machine, false),
  )
}
