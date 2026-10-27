import { describe, expect, it, vi } from 'vitest'
import { resolve, join } from 'node:path'
import { TerminalManager, commandEnvironment } from './manager'

describe('TerminalManager.stopUnder', () => {
  it('stops only running terminals whose cwd is the path or inside it', async () => {
    const manager = new TerminalManager(
      resolve('scratch-none'),
      () => ({ projectId: 'p', projectName: 'p', cwd: '.' }),
      () => {},
    )
    const base = resolve('copy-root')
    const make = (cwd: string) => ({ record: { cwd }, closing: false, timer: undefined, paused: false })
    const kills: string[] = []
    const stop = vi.fn(async (run: { record: { cwd: string } }) => {
      kills.push(run.record.cwd)
    })
    const internals = manager as unknown as { running: Map<string, unknown>; stop: typeof stop }
    internals.stop = stop
    internals.running.set('a', make(base))
    internals.running.set('b', make(join(base, 'sub')))
    internals.running.set('c', make(base + '-other'))
    internals.running.set('d', make(resolve('elsewhere')))
    await manager.stopUnder(process.platform === 'win32' ? base.toUpperCase() : base)
    expect(kills.sort()).toEqual([base, join(base, 'sub')].sort())
  })
})

describe('TerminalManager.create', () => {
  it('保存记录期间窗口关了（shutdown(owner) 已执行）：不再启动进程', async () => {
    const manager = new TerminalManager(
      resolve('scratch-none'),
      () => ({ projectId: 'p', projectName: 'p', cwd: process.cwd() }),
      () => {},
    )
    let release!: () => void
    const saving = new Promise<void>(r => {
      release = r
    })
    const internals = manager as unknown as {
      settle: () => Promise<void>
      save: () => Promise<void>
      start: (owner: number, record: unknown) => unknown
      profiles: Array<{ id: string; label: string; available: boolean }>
    }
    internals.settle = async () => {}
    internals.profiles = [{ id: 'sh', label: 'Shell', available: true }]
    internals.save = vi.fn().mockReturnValueOnce(saving).mockResolvedValue(undefined)
    const start = vi.fn()
    internals.start = start
    const created = manager.create(1, { projectId: 'p' }, 'sh', 'req-1')
    await new Promise(r => setTimeout(r, 0))
    await manager.shutdown(1)
    release()
    await expect(created).resolves.toMatchObject({ status: 'stopped' })
    expect(start).not.toHaveBeenCalled()
  })
})

describe('TerminalManager.spawnCommand', () => {
  it('does not persist session terminals or count toward the 12 limit', () => {
    const manager = new TerminalManager(
      resolve('scratch-tui-none'),
      () => ({ projectId: 'p', projectName: 'p', cwd: process.cwd() }),
      () => {},
    )
    const internals = manager as unknown as {
      startCommand: (...args: unknown[]) => { id: string; sessionId?: string }
      save: () => Promise<void>
      records: Array<{ sessionId?: string }>
    }
    const save = vi.fn()
    internals.save = save
    internals.startCommand = (_owner, record) => ({ ...(record as object), status: 'running' }) as never
    const record = manager.spawnCommand({
      owner: 1,
      cwd: process.cwd(),
      command: 'claude',
      args: ['--resume', 'x'],
      label: 'Claude Code',
      sessionId: 'sess-1',
      projectId: 'p',
      projectName: 'p',
    })
    expect(record.sessionId).toBe('sess-1')
    expect(save).not.toHaveBeenCalled()
    expect(internals.records.filter(r => r.sessionId).length).toBe(1)
    const state = manager.state(1)
    expect(state.terminals.every(t => !t.sessionId)).toBe(true)
  })
})

describe('commandEnvironment', () => {
  it('以引擎给的 env 为底：本进程里的 Claude 子会话标记不带进去，引擎的 PIXELSKY_* 保留', () => {
    const source = { PATH: '/bin', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDECODE: '1' }
    const engine = {
      PATH: '/bin:/extra',
      CLAUDE_CONFIG_DIR: '/acct',
      PIXELSKY_GATEWAY_SETTINGS: '{}',
      NODE_OPTIONS: '--x',
    }
    const env = commandEnvironment(engine, source)
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined()
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.PATH).toBe('/bin:/extra')
    expect(env.CLAUDE_CONFIG_DIR).toBe('/acct')
    expect(env.PIXELSKY_GATEWAY_SETTINGS).toBe('{}')
    expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.TERM).toBe('xterm-256color')
  })
})
