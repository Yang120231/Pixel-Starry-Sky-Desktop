import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as pty from 'node-pty'
import type {
  TerminalEvent,
  TerminalProfile,
  TerminalProfileInput,
  TerminalRecord,
  TerminalState,
} from '../../shared/types/terminal'
import type { WorkspaceRef } from '../../shared/types/workspace'
import { detectProfiles, profileInput, terminalEnvironment, terminalTitle } from './profiles'

export interface TerminalTarget {
  projectId: string
  projectName: string
  cwd: string
}
interface Runtime {
  child: pty.IPty
  record: TerminalRecord
  owner: number
  generation: number
  seq: number
  pending: string
  inflight: Map<number, number>
  bytes: number
  paused: boolean
  closing: boolean
  timer?: ReturnType<typeof setTimeout>
  done: Promise<void>
  finish: () => void
}
const HIGH = 256 * 1024,
  LOW = 64 * 1024,
  HARD = 4 * 1024 * 1024
export class TerminalManager {
  private readonly file: string
  private records: TerminalRecord[] = []
  private profiles: TerminalProfile[] = detectProfiles()
  private defaultId = this.profiles.find(p => p.available)?.id ?? 'powershell'
  private running = new Map<string, Runtime>()
  private owners = new Map<string, number>()
  private busy = new Set<string>()
  private creates = new Map<string, Promise<TerminalRecord>>()
  private writes: Promise<void> = Promise.resolve()
  private stopping = false
  constructor(
    dataDir: string,
    private resolve: (ref: WorkspaceRef) => TerminalTarget,
    private emit: (owner: number, event: TerminalEvent) => void,
  ) {
    this.file = join(dataDir, 'terminal', 'terminals.json')
  }
  async init(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'))
      const custom: TerminalProfile[] = []
      for (const raw of Array.isArray(data.profiles) ? data.profiles.slice(0, 20) : []) {
        try {
          const p = profileInput(raw)
          if (p.id) custom.push({ ...p, id: p.id, available: false, custom: true })
        } catch {
          /* ignore invalid profile */
        }
      }
      this.profiles = detectProfiles(custom)
      if (typeof data.defaultProfileId === 'string' && this.profiles.some(p => p.id === data.defaultProfileId))
        this.defaultId = data.defaultProfileId
      const ids = new Set<string>()
      for (const raw of Array.isArray(data.terminals) ? data.terminals.slice(0, 12) : []) {
        if (
          !raw ||
          !['id', 'projectId', 'projectName', 'cwd', 'profileId', 'profileLabel', 'title'].every(
            k => typeof raw[k] === 'string' && raw[k].length > 0 && raw[k].length <= 4096,
          ) ||
          ids.has(raw.id)
        )
          continue
        try {
          const record: TerminalRecord = {
            id: raw.id,
            projectId: raw.projectId,
            projectName: raw.projectName,
            cwd: raw.cwd,
            profileId: raw.profileId,
            profileLabel: raw.profileLabel,
            title: terminalTitle(raw.title),
            titleEdited: !!raw.titleEdited,
            status: 'stopped',
            generation: 0,
            createdAt: Number(raw.createdAt) || Date.now(),
          }
          this.records.push(record)
          ids.add(record.id)
        } catch {
          /* invalid metadata never starts a shell */
        }
      }
    } catch {
      /* first use or damaged state */
    }
  }
  private save(): Promise<void> {
    const data = JSON.stringify(
      {
        version: 1,
        defaultProfileId: this.defaultId,
        profiles: this.profiles.filter(p => p.custom),
        terminals: this.records.map(r => ({
          ...r,
          status: 'stopped',
          error: undefined,
          exitCode: undefined,
          generation: 0,
        })),
      },
      null,
      2,
    )
    const task = this.writes
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true })
        await writeFile(this.file + '.tmp', data, 'utf8')
        await rename(this.file + '.tmp', this.file)
      })
    this.writes = task
    return task
  }
  state(owner: number, force = false): TerminalState {
    if (force) this.profiles = detectProfiles(this.profiles.filter(p => p.custom))
    return {
      profiles: this.profiles.map(p => ({ ...p, args: [...p.args] })),
      defaultProfileId: this.defaultId,
      terminals: this.records
        .filter(r => !this.owners.has(r.id) || this.owners.get(r.id) === owner)
        .map(r => ({ ...r })),
    }
  }
  private record(owner: number, id: string): TerminalRecord {
    const r = this.records.find(r => r.id === id)
    if (!r || (this.owners.has(id) && this.owners.get(id) !== owner)) throw new Error('终端已不存在或属于其他窗口')
    return r
  }
  private update(r: TerminalRecord): void {
    const owner = this.owners.get(r.id)
    if (owner !== undefined) this.emit(owner, { type: 'record', record: { ...r } })
  }
  async setDefault(owner: number, id: string): Promise<TerminalState> {
    if (!this.profiles.some(p => p.id === id && p.available)) throw new Error('所选 Shell 不可用')
    this.defaultId = id
    await this.save()
    return this.state(owner)
  }
  async saveProfile(owner: number, input: TerminalProfileInput): Promise<TerminalState> {
    const p = profileInput(input)
    if (!p.id && this.profiles.filter(p => p.custom).length >= 20) throw new Error('最多保存 20 个自定义 Shell')
    if (p.id && !this.profiles.some(item => item.id === p.id && item.custom)) throw new Error('所选 Shell 不可用')
    const profile = { ...p, id: p.id ?? 'custom-' + randomUUID(), custom: true, available: false }
    this.profiles = detectProfiles([...this.profiles.filter(p => p.custom && p.id !== profile.id), profile])
    await this.save()
    return this.state(owner)
  }
  async removeProfile(owner: number, id?: string): Promise<TerminalState> {
    if (id && !this.profiles.some(p => p.id === id && p.custom)) throw new Error('只能修改自定义 Shell')
    this.profiles = detectProfiles(id ? this.profiles.filter(p => p.custom && p.id !== id) : [])
    if (!id || id === this.defaultId) this.defaultId = this.profiles.find(p => p.available)?.id ?? 'powershell'
    await this.save()
    return this.state(owner)
  }
  create(owner: number, ref: WorkspaceRef, profileId: string | undefined, requestId: string): Promise<TerminalRecord> {
    if (typeof requestId !== 'string' || !requestId || requestId.length > 160)
      return Promise.reject(new Error('终端请求不正确'))
    const key = owner + ':' + requestId,
      old = this.creates.get(key)
    if (old) return old
    const task = this.createOnce(owner, ref, profileId)
    this.creates.set(key, task)
    if (this.creates.size > 64) this.creates.delete(this.creates.keys().next().value!)
    return task
  }
  private async createOnce(owner: number, ref: WorkspaceRef, profileId?: string): Promise<TerminalRecord> {
    if (this.stopping) throw new Error('终端正在关闭')
    if (this.records.length >= 12) throw new Error('最多打开 12 个终端，请先关闭部分标签')
    const target = this.resolve(ref)
    const profile = this.profiles.find(p => p.id === (profileId ?? this.defaultId))
    if (!profile?.available) throw new Error('所选 Shell 不可用')
    this.checkDirectory(target.cwd)
    const record: TerminalRecord = {
      id: randomUUID(),
      ...target,
      title: profile.label,
      titleEdited: false,
      profileId: profile.id,
      profileLabel: profile.label,
      status: 'stopped',
      generation: 0,
      createdAt: Date.now(),
    }
    this.records.push(record)
    this.owners.set(record.id, owner)
    await this.save()
    return this.start(owner, record)
  }
  private checkDirectory(cwd: string): void {
    try {
      if (statSync(cwd).isDirectory()) return
    } catch {}
    throw new Error('项目目录不存在')
  }
  private start(owner: number, record: TerminalRecord): TerminalRecord {
    if (this.stopping) throw new Error('终端正在关闭')
    record.generation++
    record.status = 'starting'
    record.error = undefined
    record.exitCode = undefined
    this.owners.set(record.id, owner)
    this.update(record)
    try {
      const target = this.resolve({ projectId: record.projectId })
      this.checkDirectory(target.cwd)
      this.checkDirectory(record.cwd)
      const profile = this.profiles.find(p => p.id === record.profileId)
      if (!profile?.available) throw new Error('所选 Shell 不可用')
      const child = pty.spawn(profile.command, profile.args, {
        name: 'xterm-256color',
        cols: 100,
        rows: 24,
        cwd: record.cwd,
        env: terminalEnvironment(process.env),
        useConpty: true,
      })
      let finish!: () => void
      const done = new Promise<void>(r => {
        finish = r
      })
      const run: Runtime = {
        child,
        record,
        owner,
        generation: record.generation,
        seq: 0,
        pending: '',
        inflight: new Map(),
        bytes: 0,
        paused: false,
        closing: false,
        done,
        finish,
      }
      this.running.set(record.id, run)
      const dataSub = child.onData(data => {
        if (this.running.get(record.id) !== run || run.closing) return
        run.pending += data
        if (run.pending.length + run.bytes > HIGH && !run.paused) {
          child.pause()
          run.paused = true
        }
        if (run.pending.length > HARD) {
          record.error = '终端输出超过缓冲上限，进程已停止'
          void this.stop(run).catch(() => {})
          return
        }
        if (!run.timer)
          run.timer = setTimeout(() => {
            run.timer = undefined
            this.flush(run)
          }, 12)
      })
      const exitSub = child.onExit(({ exitCode }) => {
        if (this.running.get(record.id) === run) {
          this.flush(run)
          this.running.delete(record.id)
          record.status = 'exited'
          record.exitCode = exitCode
          this.update(record)
        }
        clearTimeout(run.timer)
        dataSub.dispose()
        exitSub.dispose()
        finish()
      })
      record.status = 'running'
      record.lastStartedAt = Date.now()
      record.profileLabel = profile.label
      this.update(record)
    } catch (cause) {
      record.status = 'error'
      record.error = String(cause instanceof Error ? cause.message : cause)
      this.update(record)
    }
    return { ...record }
  }
  private flush(run: Runtime): void {
    while (run.pending && run.bytes < HIGH && !run.closing) {
      const data = run.pending.slice(0, 32768)
      run.pending = run.pending.slice(data.length)
      const seq = ++run.seq
      run.inflight.set(seq, data.length)
      run.bytes += data.length
      this.emit(run.owner, { type: 'data', terminalId: run.record.id, generation: run.generation, seq, data })
    }
  }
  ack(owner: number, id: string, generation: number, seq: number): void {
    const run = this.running.get(id)
    if (!run || run.owner !== owner || run.generation !== generation) return
    const size = run.inflight.get(seq)
    if (size === undefined) return
    run.bytes -= size
    run.inflight.delete(seq)
    this.flush(run)
    if (run.paused && run.bytes + run.pending.length < LOW) {
      run.paused = false
      run.child.resume()
    }
  }
  write(owner: number, id: string, generation: number, data: string): void {
    this.record(owner, id)
    const run = this.running.get(id)
    if (typeof data !== 'string' || data.length > 256 * 1024) throw new Error('终端输入过长')
    if (!run || run.closing || run.generation !== generation) throw new Error('终端尚未启动')
    run.child.write(data)
  }
  resize(owner: number, id: string, generation: number, cols: number, rows: number): void {
    this.record(owner, id)
    const run = this.running.get(id)
    if (!run || run.closing || run.generation !== generation) return
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 500 || rows < 2 || rows > 300)
      throw new Error('终端尺寸不正确')
    try {
      run.child.resize(cols, rows)
    } catch {
      /* exit can race the last resize */
    }
  }
  async rename(owner: number, id: string, value: string): Promise<TerminalRecord> {
    const record = this.record(owner, id)
    record.title = terminalTitle(value)
    record.titleEdited = true
    this.update(record)
    await this.save()
    return { ...record }
  }
  private async stop(run: Runtime): Promise<void> {
    run.closing = true
    clearTimeout(run.timer)
    if (run.paused) run.child.resume()
    try {
      run.child.kill()
    } catch {
      run.finish()
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        run.done,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('终端未能停止，请重试')), 5000)
        }),
      ])
    } finally {
      clearTimeout(timeout)
    }
  }
  async change(owner: number, id: string, restart: boolean, force = false): Promise<TerminalRecord | void> {
    const record = this.record(owner, id)
    if (this.busy.has(id)) throw new Error('终端正在关闭')
    const run = this.running.get(id)
    if (run && !force) throw new Error('TERMINAL_RUNNING')
    this.busy.add(id)
    try {
      if (run) await this.stop(run)
      if (restart) return this.start(owner, record)
      this.records = this.records.filter(r => r.id !== id)
      this.owners.delete(id)
      await this.save()
    } finally {
      this.busy.delete(id)
    }
  }
  /** 停掉工作目录在 path 里（含 path 本身）的运行中终端，保留终端记录（删除副本前释放目录占用，GitHub #37） */
  async stopUnder(path: string): Promise<void> {
    const fold = (v: string): string => (process.platform === 'win32' ? resolve(v).toLowerCase() : resolve(v))
    const root = fold(path)
    const runs = [...this.running.values()].filter(run => {
      const rel = relative(root, fold(run.record.cwd))
      return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)
    })
    await Promise.all(runs.map(run => this.stop(run)))
  }
  hasRunning(owner?: number): boolean {
    return [...this.running.values()].some(run => owner === undefined || run.owner === owner)
  }
  async shutdown(owner?: number): Promise<void> {
    if (owner === undefined) this.stopping = true
    const runs = [...this.running.values()].filter(r => owner === undefined || r.owner === owner)
    await Promise.all(runs.map(run => this.stop(run)))
    for (const [id, owning] of this.owners) if (owner === undefined || owning === owner) this.owners.delete(id)
    await this.save()
  }
}
