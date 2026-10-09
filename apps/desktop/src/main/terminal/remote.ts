import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import type { ClientChannel } from 'ssh2'
import type { TerminalEvent, TerminalRecord, TerminalState } from '../../shared/types/terminal'
import type { WorkspaceRef } from '../../shared/types/workspace'
import { terminalTitle } from './profiles'
import { machineOf } from '../machines/identity'
import { quoteSh } from '../machines/ssh'
import type { Machines } from '../machines/service'

interface Run {
  channel: ClientChannel
  owner: number
  seq: number
  generation: number
  inflight: Map<number, number>
  bytes: number
  decoder: StringDecoder
}
export class RemoteTerminals {
  private records: TerminalRecord[] = []
  private runs = new Map<string, Run>()
  private changing = new Set<string>()
  private writes = Promise.resolve()
  private requests = new Map<string, Promise<TerminalRecord>>()
  private file: string
  constructor(
    private machines: Machines,
    dir: string,
    private emit: (owner: number, event: TerminalEvent) => void,
  ) {
    this.file = join(dir, 'ssh-terminals.json')
  }
  async init(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'))
      if (Array.isArray(data))
        this.records = data
          .filter(r => machineOf(r.id) !== 'local' && typeof r.cwd === 'string')
          .slice(0, 36)
          .map(r => ({ ...r, status: 'stopped', generation: 0 }))
    } catch {}
  }
  private save(): Promise<void> {
    const data = JSON.stringify(this.records.map(r => ({ ...r, status: 'stopped', generation: 0, error: undefined })))
    this.writes = this.writes.catch(() => {}).then(() => writeFile(this.file, data, { mode: 0o600 }))
    return this.writes
  }
  state(owner: number): TerminalState {
    const machine = this.machines.currentId,
      remote = this.machines.state().machines.find(m => m.id === machine)
    return {
      profiles: [
        {
          id: 'ssh-shell',
          label: 'SSH Shell',
          command:
            remote?.status === 'connected' ? (this.machines.connection(machine).hello?.shell ?? '/bin/sh') : '/bin/sh',
          args: [],
          available: remote?.status === 'connected',
        },
      ],
      defaultProfileId: 'ssh-shell',
      terminals: this.records
        .filter(r => !this.runs.has(r.id) || this.runs.get(r.id)?.owner === owner)
        .map(r => ({ ...r })),
    }
  }
  private record(owner: number, id: string): TerminalRecord {
    const record = this.records.find(r => r.id === id),
      run = this.runs.get(id)
    if (!record || (run && run.owner !== owner)) throw new Error('终端已不存在或属于其他窗口')
    return record
  }
  create(owner: number, ref: WorkspaceRef, profile: string | undefined, requestId: string): Promise<TerminalRecord> {
    if (profile && profile !== 'ssh-shell') return Promise.reject(new Error('所选 Shell 不可用'))
    if (!requestId || requestId.length > 160) return Promise.reject(new Error('终端请求不正确'))
    const key = owner + ':' + requestId,
      existing = this.requests.get(key)
    if (existing) return existing
    const promise = this.createOnce(owner, ref)
    this.requests.set(key, promise)
    if (this.requests.size > 64) this.requests.delete(this.requests.keys().next().value!)
    return promise
  }
  private async createOnce(owner: number, ref: WorkspaceRef): Promise<TerminalRecord> {
    if (this.records.length >= 36) throw new Error('最多打开 12 个终端，请先关闭部分标签')
    const machine = machineOf(ref.projectId ?? ref.sessionId),
      target = this.machines.target(ref)
    if (!target) throw new Error('项目已不存在')
    const projectId = ref.projectId ?? this.machines.record(ref.sessionId!)?.projectId
    if (!projectId) throw new Error('项目已不存在')
    const record: TerminalRecord = {
      id: machine + '~' + randomUUID(),
      projectId,
      projectName: target.name,
      cwd: target.path,
      profileId: 'ssh-shell',
      profileLabel: 'SSH Shell',
      title: 'SSH Shell',
      titleEdited: false,
      status: 'stopped',
      generation: 0,
      createdAt: Date.now(),
    }
    this.records.push(record)
    await this.save()
    return this.start(owner, record)
  }
  private async start(owner: number, record: TerminalRecord): Promise<TerminalRecord> {
    const connection = this.machines.connection(machineOf(record.id)),
      shell = connection.hello?.shell || '/bin/sh'
    record.generation++
    record.status = 'starting'
    record.error = undefined
    this.emit(owner, { type: 'record', record: { ...record } })
    try {
      const channel = await connection.channel('cd -- ' + quoteSh(record.cwd) + ' && exec ' + quoteSh(shell) + ' -l', {
        cols: 100,
        rows: 24,
      })
      const run: Run = {
        channel,
        owner,
        seq: 0,
        generation: record.generation,
        inflight: new Map(),
        bytes: 0,
        decoder: new StringDecoder('utf8'),
      }
      this.runs.set(record.id, run)
      const output = (buffer: Buffer) => {
        const text = run.decoder.write(buffer)
        for (let offset = 0; offset < text.length; offset += 32768) {
          const data = text.slice(offset, offset + 32768),
            seq = ++run.seq
          run.inflight.set(seq, data.length)
          run.bytes += data.length
          this.emit(owner, { type: 'data', terminalId: record.id, generation: run.generation, seq, data })
        }
        if (run.bytes > 256 * 1024) channel.pause()
      }
      channel.on('data', output)
      channel.stderr.on('data', output)
      channel.on('error', (error: Error) => {
        record.error = error.message
      })
      channel.on('close', (code: number | undefined) => {
        if (this.runs.get(record.id) !== run) return
        this.runs.delete(record.id)
        record.status = 'exited'
        record.exitCode = code
        if (this.machines.state().machines.find(m => m.id === machineOf(record.id))?.status !== 'connected')
          record.error = 'SSH_CONNECTION_CLOSED'
        this.emit(owner, { type: 'record', record: { ...record } })
      })
      record.status = 'running'
      record.lastStartedAt = Date.now()
      this.emit(owner, { type: 'record', record: { ...record } })
    } catch (error) {
      record.status = 'error'
      record.error = (error as Error).message
      this.emit(owner, { type: 'record', record: { ...record } })
    }
    return { ...record }
  }
  write(owner: number, id: string, generation: number, data: string): void {
    this.record(owner, id)
    const run = this.runs.get(id)
    if (!run || run.generation !== generation) throw new Error('终端尚未启动')
    if (typeof data !== 'string' || data.length > 256 * 1024) throw new Error('终端输入过长')
    run.channel.write(data)
  }
  resize(owner: number, id: string, generation: number, cols: number, rows: number): void {
    this.record(owner, id)
    const run = this.runs.get(id)
    if (!run || run.generation !== generation) return
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 500 || rows < 2 || rows > 300)
      throw new Error('终端尺寸不正确')
    run.channel.setWindow(rows, cols, 0, 0)
  }
  ack(owner: number, id: string, generation: number, seq: number): void {
    const run = this.runs.get(id)
    if (!run || run.owner !== owner || run.generation !== generation) return
    const size = run.inflight.get(seq)
    if (size !== undefined) {
      run.inflight.delete(seq)
      run.bytes -= size
      if (run.bytes < 64 * 1024) run.channel.resume()
    }
  }
  async rename(owner: number, id: string, title: string): Promise<TerminalRecord> {
    const record = this.record(owner, id)
    record.title = terminalTitle(title)
    record.titleEdited = true
    await this.save()
    this.emit(owner, { type: 'record', record: { ...record } })
    return { ...record }
  }
  async change(owner: number, id: string, restart: boolean, force = false): Promise<TerminalRecord | void> {
    const record = this.record(owner, id),
      run = this.runs.get(id)
    if (this.changing.has(id)) throw new Error('终端正在关闭')
    if (run && !force) throw new Error('TERMINAL_RUNNING')
    this.changing.add(id)
    try {
      if (run) await this.stop(run)
      if (restart) return this.start(owner, record)
      this.records = this.records.filter(r => r.id !== id)
      await this.save()
    } finally {
      this.changing.delete(id)
    }
  }
  private async stop(run: Run): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('终端未能停止，请重试')), 5000)
      run.channel.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      run.channel.signal('TERM')
      run.channel.close()
    })
  }
  hasRunning(owner?: number): boolean {
    return [...this.runs.values()].some(r => owner === undefined || r.owner === owner)
  }
  async shutdown(owner?: number): Promise<void> {
    for (const [id, run] of [...this.runs])
      if (owner === undefined || owner === run.owner) {
        await this.stop(run)
        const record = this.records.find(r => r.id === id)
        if (record) {
          record.status = 'stopped'
          this.emit(run.owner, { type: 'record', record: { ...record } })
        }
      }
    await this.save()
  }
}
