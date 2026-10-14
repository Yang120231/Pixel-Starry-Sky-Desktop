import { spawn as realSpawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer, connect, type Server } from 'node:net'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { REMOTE_PROTOCOL } from '@pixelsky/protocol'
import { WslConnection, WslNotReady, helperArgs, installArgs, installScript, shellArgs, wslExe } from './wsl'
import { wslMachineId } from './wslList'

const ptys = vi.hoisted(() => ({ spawned: [] as Array<{ args: unknown[]; kill: ReturnType<typeof vi.fn> }> }))
vi.mock('node-pty', () => ({
  spawn: (...args: unknown[]) => {
    const p = { args, kill: vi.fn(), onExit: vi.fn(), onData: vi.fn(), write: vi.fn(), resize: vi.fn() }
    ptys.spawned.push(p)
    return p
  },
}))

const hash = createHash('sha256').update('x').digest('hex')

describe('wsl 参数构造', () => {
  it('wslExe 指向 System32', () => {
    expect(wslExe().toLowerCase()).toMatch(/system32[\\/]wsl\.exe$/)
  })
  it('安装脚本不含 Windows 命令行会弄坏的字符', () => {
    const script = installScript(hash)
    for (const bad of ['"', '$', '`', '%', '\n', '\\']) expect(script).not.toContain(bad)
    expect(script).toContain(hash)
    expect(script).toContain('v' + REMOTE_PROTOCOL)
  })
  it('安装脚本拒绝不是哈希的输入', () => {
    expect(() => installScript("x'+process.exit()+'")).toThrow('WSL_INVALID_HASH')
  })
  it('installArgs 用 --exec 直接跑 node -e', () => {
    const args = installArgs('Ubuntu', '/usr/bin/node', hash)
    expect(args.slice(0, 7)).toEqual(['-d', 'Ubuntu', '--cd', '~', '--exec', '/usr/bin/node', '-e'])
    expect(args).toHaveLength(8)
  })
  it('helperArgs 编码不是 UTF-8 时才加 LANG', () => {
    const id = wslMachineId('Ubuntu')
    expect(helperArgs('Ubuntu', '/n/node', '/h/helper.cjs', id, false)).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '~',
      '--exec',
      '/n/node',
      '/h/helper.cjs',
      id,
    ])
    expect(helperArgs('Ubuntu', '/n/node', '/h/helper.cjs', id, true).slice(5, 8)).toEqual([
      'env',
      'LANG=C.UTF-8',
      'LC_ALL=C.UTF-8',
    ])
  })
  it('shellArgs 用登录 shell 并进到工作目录', () => {
    expect(shellArgs('Ubuntu', '/home/a b', '/bin/bash')).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '/home/a b',
      '--exec',
      '/bin/bash',
      '-l',
    ])
  })
})

const hasSh = spawnSync('sh', ['-c', 'true']).status === 0
const itSh = hasSh ? it : it.skip
// 「平台不是 linux」靠 Windows 的 node 自报 win32，只在 Windows 上成立
const itWin = hasSh && process.platform === 'win32' ? it : it.skip
const fake = resolve(__dirname, '__fixtures__', 'fake-wsl.cjs')
const scratch = resolve('../../scratch')
let work: string
let helperFile: string
const cleanup: Array<() => void | Promise<void>> = []

// 用 electron.remote.config.ts 打出真实的远端程序
beforeAll(async () => {
  await mkdir(scratch, { recursive: true })
  work = await mkdtemp(join(scratch, 'wsl-test-'))
  if (!hasSh) return
  const { build } = await import('electron-vite')
  const out = join(work, 'helper')
  await build({ configFile: resolve('electron.remote.config.ts'), logLevel: 'error', build: { outDir: out } })
  helperFile = join(out, 'main', 'helper.cjs')
}, 120_000)
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
afterAll(() => rm(work, { recursive: true, force: true }).catch(() => {}))

function setup() {
  const home = join(work, 'home' + Math.random().toString(36).slice(2)).replaceAll('\\', '/')
  const children: ChildProcess[] = []
  const spawn = ((_exe: string, args: string[], options: { env?: object }) => {
    const child = realSpawn(process.execPath, [fake, ...args], {
      ...options,
      env: { ...options.env, FAKE_WSL_HOME: home },
    })
    children.push(child)
    return child
  }) as unknown as typeof realSpawn
  return { home, spawn, children }
}
const connection = () => {
  const link = new WslConnection()
  cleanup.push(() => link.close())
  return { link, id: wslMachineId('Ubuntu') }
}
const handler = async () => null

describe('WslConnection（假 wsl.exe）', () => {
  itSh(
    '探测、上传、握手、调用、网关隧道往返、关闭',
    async () => {
      const { home, spawn, children } = setup()
      await mkdir(home, { recursive: true })
      const { link, id } = connection()
      const { hello, probe, items } = await link.connect('Ubuntu', id, process.execPath, helperFile, handler, {
        spawn,
        requireLinux: false,
      })
      expect(hello.protocol).toBe(REMOTE_PROTOCOL)
      expect(probe.home).toBe(home)
      expect(items.find(i => i.key === 'node')?.status).toBe('ok')
      const names = await readdir(join(home, '.local/share/pixelsky/remote/v' + REMOTE_PROTOCOL))
      const sum = createHash('sha256')
        .update(await readFile(helperFile))
        .digest('hex')
      expect(names).toEqual(['helper-' + sum + '.cjs'])

      expect(await link.peer!.call('engine:projects', [])).toBeDefined()
      expect((await link.stats())?.processes).toBeGreaterThan(0)

      // 本地 echo 服务器，经远端监听端口往返
      const echo: Server = createServer(s => s.pipe(s))
      await new Promise<void>(r => echo.listen(0, '127.0.0.1', r))
      cleanup.push(() => void echo.close())
      const echoPort = (echo.address() as { port: number }).port
      const remotePort = await link.forwardGateway(echoPort)
      expect(await link.forwardGateway(echoPort)).toBe(remotePort)
      const reply = await new Promise<string>((res, rej) => {
        const s = connect(remotePort, '127.0.0.1')
        s.on('error', rej)
        s.on('data', d => {
          res(d.toString())
          s.destroy()
        })
        s.write('ping')
      })
      expect(reply).toBe('ping')

      // forwardPort：不走直连，即使 Windows 这边同端口有人在听也返回隧道的本地端口
      expect(await link.forwardPort(echoPort)).not.toBe(echoPort)

      const helper = children[children.length - 1]
      const exited = new Promise(r => helper.once('exit', r))
      link.close()
      await Promise.race([exited, new Promise((_, rej) => setTimeout(() => rej(new Error('helper 没退出')), 10_000))])
    },
    60_000,
  )

  itSh(
    '后台被杀时触发 WSL_CONNECTION_CLOSED',
    async () => {
      const { home, spawn, children } = setup()
      await mkdir(home, { recursive: true })
      const { link, id } = connection()
      const closed: string[] = []
      link.onClose = m => closed.push(m)
      await link.connect('Ubuntu', id, process.execPath, helperFile, handler, { spawn, requireLinux: false })
      children[children.length - 1].kill()
      await new Promise(r => setTimeout(r, 1500))
      expect(closed).toEqual(['WSL_CONNECTION_CLOSED'])
    },
    60_000,
  )

  itWin(
    '平台不是 linux 时报协议不匹配',
    async () => {
      const { home, spawn } = setup()
      await mkdir(home, { recursive: true })
      const { link, id } = connection()
      await expect(link.connect('Ubuntu', id, process.execPath, helperFile, handler, { spawn })).rejects.toThrow(
        'SSH_PROTOCOL_MISMATCH',
      )
    },
    60_000,
  )

  itSh(
    'forwardPort：一律走隧道并往返',
    async () => {
      const { home, spawn } = setup()
      await mkdir(home, { recursive: true })
      const { link, id } = connection()
      await link.connect('Ubuntu', id, process.execPath, helperFile, handler, {
        spawn,
        requireLinux: false,
      })
      const echo: Server = createServer(s => s.pipe(s))
      await new Promise<void>(r => echo.listen(0, '127.0.0.1', r))
      cleanup.push(() => void echo.close())
      const echoPort = (echo.address() as { port: number }).port
      const local = await link.forwardPort(echoPort)
      expect(await link.forwardPort(echoPort)).toBe(local)
      const reply = await new Promise<string>((res, rej) => {
        const s = connect(local, '127.0.0.1')
        s.on('error', rej)
        s.on('data', d => {
          res(d.toString())
          s.destroy()
        })
        s.write('pong')
      })
      expect(reply).toBe('pong')
    },
    60_000,
  )

  // 只替换「起后台程序」那一次 spawn（参数里带 .cjs），其余照常走假 wsl.exe
  const withHelper = (base: typeof realSpawn, helper: string[]) =>
    ((exe: string, args: string[], options: object) =>
      args.some(a => a.endsWith('.cjs'))
        ? realSpawn(process.execPath, helper, options)
        : base(exe, args, options)) as unknown as typeof realSpawn

  itSh(
    '后台启动就退出且报已有连接时抛 SSH_ALREADY_CONNECTED，不触发 onClose',
    async () => {
      const { home, spawn } = setup()
      await mkdir(home, { recursive: true })
      const { link, id } = connection()
      const closed: string[] = []
      link.onClose = m => closed.push(m)
      const bad = withHelper(spawn, ['-e', "process.stderr.write('SSH_ALREADY_CONNECTED');process.exit(1)"])
      await expect(
        link.connect('Ubuntu', id, process.execPath, helperFile, handler, { spawn: bad, requireLinux: false }),
      ).rejects.toThrow('SSH_ALREADY_CONNECTED')
      expect(closed).toEqual([])
    },
    60_000,
  )

  itSh(
    '关闭后后台不退出就强杀',
    async () => {
      const { home, spawn } = setup()
      await mkdir(home, { recursive: true })
      const { link, id } = connection()
      let stuck: ChildProcess | undefined
      const hello = JSON.stringify({ protocol: REMOTE_PROTOCOL, platform: 'linux' })
      // 假后台：回 hello，但读到 stdin 结束也不退出
      const script =
        "process.stdin.on('data',d=>{for(const l of String(d).split(String.fromCharCode(10))){if(!l.trim())continue;const m=JSON.parse(l);" +
        'process.stdout.write(JSON.stringify({id:m.id,result:' +
        hello +
        '})+String.fromCharCode(10))}});setInterval(()=>{},1000)'
      const stubborn = ((exe: string, args: string[], options: object) => {
        const child = withHelper(spawn, ['-e', script])(exe, args, options) as ChildProcess
        if (args.some(a => a.endsWith('.cjs'))) stuck = child
        return child
      }) as unknown as typeof realSpawn
      await link.connect('Ubuntu', id, process.execPath, helperFile, handler, {
        spawn: stubborn,
        requireLinux: false,
        killDelay: 200,
      })
      const exited = new Promise(r => stuck!.once('exit', r))
      link.close()
      await Promise.race([exited, new Promise((_, rej) => setTimeout(() => rej(new Error('没被强杀')), 10_000))])
    },
    60_000,
  )

  it('openShell 用 wsl.exe 起登录 shell，关闭连接时一起结束', async () => {
    const { link } = connection()
    const shell = await link.openShell('/home/a', '/bin/bash', { cols: 80, rows: 24 })
    expect(shell).toBeDefined()
    const p = ptys.spawned[ptys.spawned.length - 1]
    expect(p.args[1]).toEqual(['-d', '', '--cd', '/home/a', '--exec', '/bin/bash', '-l'])
    link.close()
    expect(p.kill).toHaveBeenCalled()
    await expect(link.openShell('/', '/bin/sh', { cols: 1, rows: 1 })).rejects.toThrow('WSL_CONNECTION_CLOSED')
  })

  it('wsl.exe 起不来时抛带检查项的 WSL_NOT_READY', async () => {
    const { link, id } = connection()
    const spawn = (() =>
      realSpawn(process.execPath, [
        '-e',
        "process.stderr.write('boom');process.exit(1)",
      ])) as unknown as typeof realSpawn
    const error = await link.connect('Ubuntu', id, undefined, 'unused', handler, { spawn }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WslNotReady)
    expect((error as WslNotReady).message).toBe('WSL_NOT_READY')
    expect((error as WslNotReady).items[0]).toMatchObject({ key: 'start', code: 'WSL_START_FAILED', detail: 'boom' })
  })

  it('机器 ID 格式不对直接拒绝', async () => {
    const { link } = connection()
    await expect(link.connect('Ubuntu', 'bad id', undefined, 'x', handler)).rejects.toThrow('SSH_INVALID_CONFIG')
  })
})
