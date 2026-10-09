import { app, clipboard, dialog, safeStorage } from 'electron'
import { join, isAbsolute, posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hostname, homedir } from 'node:os'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import type { EngineHost } from '@pixelsky/engine'
import type { HostEvent, ProjectRecord, SessionRecord, SessionSummary } from '@pixelsky/protocol'
import type { MachineInfo, MachineInput, MachineState } from '../../shared/types/machines'
import type { WorkspaceRef, WorkspaceTarget } from '../../shared/types/workspace'
import * as ipc from '../ipc/guard'
import { platformCharges } from '../platform/billing'
import { validateQueuedInput } from '../platform/platform'
import type { AppContext } from '../app/context'
import type { EventBus, PushChannel } from '../app/events'
import { FingerprintRequired, SshConnection } from './ssh'
import { machineOf, remoteIds, remoteArguments, remoteMethod } from './identity'
import { resolveRoute } from './routing'
import { addProjectPath } from '../core/engine/ops'

interface StoredMachine extends Omit<MachineInput, 'password' | 'passphrase'> {
  id: string
  secret?: string
  fingerprint: string | null
}
interface RemoteState {
  info: MachineInfo
  connection?: SshConnection
  pendingFingerprint?: string
  projects: ProjectRecord[]
  sessions: SessionSummary[]
  executions: Map<string, SessionRecord>
}
function input(value: MachineInput): MachineInput {
  if (!value || !['agent', 'key', 'password'].includes(value.auth)) throw new Error('SSH_INVALID_CONFIG')
  for (const key of ['name', 'host', 'username'] as const)
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 255 || /[\r\n\0]/.test(value[key]))
      throw new Error('SSH_INVALID_CONFIG')
  if (
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    /[\s/@]/.test(value.host) ||
    /[\s@]/.test(value.username)
  )
    throw new Error('SSH_INVALID_CONFIG')
  if (value.auth === 'key' && (!value.privateKeyPath || !isAbsolute(value.privateKeyPath)))
    throw new Error('SSH_KEY_REQUIRED')
  return {
    id: value.id,
    name: value.name.trim(),
    host: value.host.trim(),
    port: value.port,
    username: value.username.trim(),
    auth: value.auth,
    privateKeyPath: value.privateKeyPath,
    password: typeof value.password === 'string' ? value.password : undefined,
    passphrase: typeof value.passphrase === 'string' ? value.passphrase : undefined,
  }
}
export class Machines {
  currentId = 'local'
  private configs: StoredMachine[] = []
  private states = new Map<string, RemoteState>()
  private memorySecrets = new Map<string, { password?: string; passphrase?: string }>()
  private busy = new Set<string>()
  private saving: Promise<void> = Promise.resolve()
  private file = join(app.getPath('userData'), 'machines.json')
  constructor(
    private host: EngineHost,
    private environment: (record: SessionRecord) => NodeJS.ProcessEnv,
    private events: EventBus,
  ) {}
  async init(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'))
      this.configs = Array.isArray(saved.machines)
        ? saved.machines.filter((m: StoredMachine) => /^ssh-[a-f0-9-]+$/.test(m.id)).slice(0, 50)
        : []
    } catch {}
    for (const machine of this.configs)
      this.states.set(machine.id, {
        info: {
          ...machine,
          hasSecret: !!machine.secret,
          status: 'disconnected',
          error: null,
          platform: null,
          home: null,
        },
        projects: [],
        sessions: [],
        executions: new Map(),
      })
  }
  state(): MachineState {
    return {
      currentId: this.currentId,
      machines: [
        {
          id: 'local',
          name: hostname(),
          host: '',
          port: 0,
          username: '',
          auth: 'local',
          status: 'local',
          hasSecret: false,
          error: null,
          fingerprint: null,
          platform: process.platform,
          home: homedir(),
        },
        ...[...this.states.values()].map(({ info }) => ({
          id: info.id,
          name: info.name,
          host: info.host,
          port: info.port,
          username: info.username,
          auth: info.auth,
          privateKeyPath: info.privateKeyPath,
          hasSecret: info.hasSecret,
          status: info.status,
          error: info.error,
          fingerprint: info.fingerprint,
          platform: info.platform,
          home: info.home,
        })),
      ],
    }
  }
  changed(): void {
    this.events.broadcast('machines:changed', this.state())
  }
  broadcast(channel: PushChannel, value: unknown): void {
    this.events.broadcast(channel, value)
  }
  projects(): ProjectRecord[] {
    return [...this.host.projects(), ...[...this.states.values()].flatMap(s => s.projects)]
  }
  sessions(): SessionSummary[] {
    return [...this.host.sessions(), ...[...this.states.values()].flatMap(s => s.sessions)].sort(
      (a, b) => b.record.updatedAt - a.record.updatedAt,
    )
  }
  hostEvent(event: HostEvent): void {
    if (event.kind === 'projects') this.broadcast('engine:event', { kind: 'projects', projects: this.projects() })
    else if (event.kind === 'sessions') this.broadcast('engine:event', { kind: 'sessions', sessions: this.sessions() })
    else if (!['engines', 'engine_config'].includes(event.kind) || this.currentId === 'local')
      this.broadcast('engine:event', event)
  }
  record(id: string): SessionRecord | null {
    const state = this.states.get(machineOf(id))
    return state?.executions.get(id) ?? state?.sessions.find(s => s.record.id === id)?.record ?? null
  }
  target(ref: WorkspaceRef): WorkspaceTarget | null {
    const id = ref.projectId ?? ref.sessionId,
      remote = this.states.get(machineOf(id))
    if (!remote) return null
    const record = ref.sessionId ? this.record(ref.sessionId) : null
    const project = remote.projects.find(p => p.id === (ref.projectId ?? record?.projectId))
    if (!record && !project) throw new Error('项目已不存在')
    return { ref, name: project?.name ?? record!.title, path: record?.cwd ?? project!.path }
  }
  private async persist(): Promise<void> {
    const data = JSON.stringify({ version: 1, machines: this.configs }, null, 2)
    this.saving = this.saving
      .catch(() => {})
      .then(async () => {
        await mkdir(app.getPath('userData'), { recursive: true })
        const temporary = this.file + '.tmp'
        await writeFile(temporary, data, { mode: 0o600 })
        await rename(temporary, this.file)
      })
    return this.saving
  }
  async save(raw: MachineInput): Promise<MachineInfo> {
    const value = input(raw),
      old = this.configs.find(m => m.id === value.id)
    if (value.id && !old) throw new Error('SSH_MACHINE_MISSING')
    if (old && this.states.get(old.id)?.info.status === 'connected') throw new Error('SSH_DISCONNECT_BEFORE_EDIT')
    const id = old?.id ?? 'ssh-' + randomUUID()
    const secrets = {
      ...(old ? this.secret(old) : {}),
      ...(value.password !== undefined ? { password: value.password } : {}),
      ...(value.passphrase !== undefined ? { passphrase: value.passphrase } : {}),
    }
    if (value.auth === 'password' && !secrets.password) throw new Error('SSH_PASSWORD_REQUIRED')
    const { password: _password, passphrase: _passphrase, ...publicValue } = value
    const machine: StoredMachine = {
      ...publicValue,
      id,
      fingerprint: old?.host === value.host && old.port === value.port ? old.fingerprint : null,
    }
    if (
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
    )
      machine.secret = safeStorage.encryptString(JSON.stringify(secrets)).toString('base64')
    this.memorySecrets.set(id, secrets)
    this.configs = [...this.configs.filter(m => m.id !== id), machine]
    const state: RemoteState = {
      info: {
        ...machine,
        hasSecret: !!secrets.password || !!secrets.passphrase,
        status: 'disconnected',
        error: null,
        platform: null,
        home: null,
      },
      projects: this.states.get(id)?.projects ?? [],
      sessions: this.states.get(id)?.sessions ?? [],
      executions: new Map(),
    }
    this.states.set(id, state)
    await this.persist()
    this.changed()
    return this.state().machines.find(m => m.id === id)!
  }
  private secret(machine: StoredMachine): { password?: string; passphrase?: string } {
    const value = this.memorySecrets.get(machine.id)
    if (value) return value
    try {
      return machine.secret ? JSON.parse(safeStorage.decryptString(Buffer.from(machine.secret, 'base64'))) : {}
    } catch {
      return {}
    }
  }
  async connect(id: string, accepted?: string) {
    const config = this.configs.find(m => m.id === id),
      state = this.states.get(id)
    if (!config || !state) throw new Error('SSH_MACHINE_MISSING')
    if (this.busy.has(id)) throw new Error('SSH_CONNECTING')
    if (
      this.configs.some(
        other =>
          other.id !== id &&
          other.host === config.host &&
          other.port === config.port &&
          other.username === config.username &&
          this.states.get(other.id)?.info.status === 'connecting',
      )
    )
      throw new Error('SSH_CONNECTING')
    if (state.connection?.peer && state.info.status === 'connected') return { connected: true }
    if (accepted && state.pendingFingerprint !== accepted) throw new Error('SSH_FINGERPRINT_CHANGED')
    this.busy.add(id)
    state.connection?.close()
    state.info.status = 'connecting'
    state.info.error = null
    this.changed()
    const connection = new SshConnection()
    state.connection = connection
    connection.onClose = message => {
      if (state.connection === connection) {
        state.info.status = 'disconnected'
        state.info.error = message
        state.executions.clear()
        this.changed()
      }
    }
    try {
      const hello = await connection.connect(
        { ...config, ...this.secret(config) },
        config.fingerprint,
        accepted,
        join(__dirname, '../remote/helper.cjs'),
        async (method, args) => {
          if (method === 'platform:environment') {
            const record = remoteIds(args[0] as SessionRecord, id, true)
            await validateQueuedInput(record)
            state.executions.set(record.id, record)
            const env = this.environment(record)
            for (const key of ['ANTHROPIC_BASE_URL', 'PIXELSKY_CODEX_BASE_URL'])
              if (env[key]) {
                const url = new URL(env[key]!),
                  remotePort = await connection.forwardGateway(Number(url.port))
                url.port = String(remotePort)
                env[key] = url.href.replace(/\/$/, '')
              }
            delete env.PIXELSKY_GATEWAY_SETTINGS
            return env
          }
          if (method === 'platform:charges')
            return platformCharges(args[0] as Parameters<typeof platformCharges>[0], AbortSignal.timeout(30_000))
          throw new Error('REMOTE_CALLBACK_UNSUPPORTED')
        },
      )
      config.fingerprint = connection.fingerprint
      state.pendingFingerprint = undefined
      Object.assign(state.info, {
        fingerprint: connection.fingerprint,
        platform: hello.platform,
        home: hello.home,
        status: 'connected',
        error: null,
      })
      connection.peer!.onEvent = (channel, raw) => {
        const event = remoteIds(raw, id, true)
        if (channel === 'engine:event') {
          const message = event as HostEvent
          if (message.kind === 'projects') {
            state.projects = message.projects
            this.hostEvent(message)
          } else if (message.kind === 'sessions') {
            state.sessions = message.sessions
            this.hostEvent(message)
          } else if (!['engines', 'engine_config'].includes(message.kind) || this.currentId === id)
            this.broadcast(channel, message)
        } else if (channel === 'projectTools:changed') this.broadcast(channel, null)
      }
      state.projects = await this.call(id, 'engine:projects', [])
      state.sessions = await this.call(id, 'engine:sessions', [])
      await this.persist()
      this.hostEvent({ kind: 'projects', projects: [] })
      this.hostEvent({ kind: 'sessions', sessions: [] })
      this.changed()
      return { connected: true }
    } catch (error) {
      connection.close()
      state.connection = undefined
      state.info.status = 'error'
      if (error instanceof FingerprintRequired) {
        state.pendingFingerprint = error.fingerprint
        state.info.error = 'SSH_FINGERPRINT_REQUIRED'
        return { connected: false, fingerprint: error.fingerprint, changed: error.changed }
      }
      state.info.error = (error as Error).message
      throw error
    } finally {
      this.busy.delete(id)
      this.changed()
    }
  }
  connection(id: string): SshConnection {
    const state = this.states.get(id)
    if (!state?.connection?.peer || state.info.status !== 'connected') throw new Error('SSH_NOT_CONNECTED')
    return state.connection
  }
  async call<T = any>(id: string, channel: string, args: unknown[]): Promise<T> {
    const result = await this.connection(id).peer!.call<T>(channel, remoteArguments(channel, args, id))
    return remoteIds(result, id, true)
  }
  async select(id: string) {
    if (id !== 'local') this.connection(id)
    this.currentId = id
    this.changed()
    return { projects: this.projects(), sessions: this.sessions() }
  }
  disconnect(id: string): void {
    const state = this.states.get(id)
    if (!state) return
    state.connection?.close()
    state.connection = undefined
    state.info.status = 'disconnected'
    state.executions.clear()
    this.changed()
  }
  async remove(id: string): Promise<void> {
    if (id === 'local') throw new Error('SSH_LOCAL_REQUIRED')
    this.disconnect(id)
    this.states.delete(id)
    this.configs = this.configs.filter(m => m.id !== id)
    this.memorySecrets.delete(id)
    if (this.currentId === id) this.currentId = 'local'
    await this.persist()
    this.changed()
    this.hostEvent({ kind: 'projects', projects: [] })
    this.hostEvent({ kind: 'sessions', sessions: [] })
  }
  async invoke(channel: string, args: unknown[], fallback: () => unknown): Promise<unknown> {
    const route = resolveRoute(channel, args, this.currentId)
    switch (route.kind) {
      case 'aggregate':
        return route.what === 'projects' ? this.projects() : this.sessions()
      case 'local':
        return fallback()
      case 'copyPath': {
        const target = this.target(args[0] as WorkspaceRef)!
        clipboard.writeText(posix.join(target.path, String(args[1] ?? '')))
        return
      }
      case 'target':
        return this.target(args[0] as WorkspaceRef)
      case 'usageExport': {
        const csv = await this.call<string>(route.machine, remoteMethod(channel), args)
        const result = await dialog.showSaveDialog({
          defaultPath: 'pixelsky-remote-usage.csv',
          filters: [{ name: 'CSV', extensions: ['csv'] }],
        })
        if (result.canceled || !result.filePath) return false
        await writeFile(result.filePath, csv, 'utf8')
        return true
      }
      case 'picker':
        throw new Error('SSH_USE_WORKSPACE_PICKER')
      case 'remote':
        return this.call(route.machine, remoteMethod(channel), args)
    }
  }
}
/** 创建 SSH 机器服务并放进 ctx.machines（读配置之前就放，和原来的时机一致），注册 machines:* 接口 */
export async function initMachines(
  ctx: AppContext,
  host: EngineHost,
  environment: (record: SessionRecord) => NodeJS.ProcessEnv,
): Promise<Machines> {
  const service = new Machines(host, environment, ctx.events)
  ctx.machines = service
  await service.init()
  const actions: Record<string, (...args: any[]) => unknown> = {
    state: () => service.state(),
    save: value => service.save(value),
    connect: (id, fingerprint) => service.connect(id, fingerprint),
    disconnect: id => service.disconnect(id),
    remove: id => service.remove(id),
    select: id => service.select(id),
    chooseKey: async () => {
      const result = await dialog.showOpenDialog({ properties: ['openFile'] })
      return result.canceled ? null : result.filePaths[0]
    },
    directories: (id, path) => service.call(id, remoteMethod('machines:directories'), [path]),
    addProject: (id, path) =>
      id === 'local' ? addProjectPath(host, path) : service.call(id, remoteMethod('machines:addProject'), [path]),
  }
  for (const [name, fn] of Object.entries(actions))
    ipc.handle(`machines:${name}` as ipc.InvokeChannel, (_event, ...args) => fn(...args))
  ctx.lifecycle.onShutdown(() => {
    for (const machine of service.state().machines) if (machine.id !== 'local') service.disconnect(machine.id)
  })
  return service
}
