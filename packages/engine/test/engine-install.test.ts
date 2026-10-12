import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { ENGINES, type EngineInfo, type EngineJob, type EngineUpdateResult, type HostEvent } from '@pixelsky/protocol'
import { EngineHost, type EngineAdapter } from '../src'
import { outputTail, runStream } from '../src/exec'
import { jobPhase } from '../src/host/settings'
import { makeTmp, removeTmp } from './helpers/tmp'

// 引擎一键安装和安装 / 更新的进度（docs/ui/engine-update.md）

const roots: string[] = []
const hosts: EngineHost[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(h => h.shutdown()))
  roots.splice(0).forEach(removeTmp)
})

function setup(opts: {
  installable?: boolean
  install?: (onLine: (line: string) => void) => Promise<EngineUpdateResult>
}) {
  const root = makeTmp('engine-install')
  roots.push(root)
  const events: HostEvent[] = []
  let installed = false
  const adapter: EngineAdapter = {
    info: async () =>
      ({
        ...ENGINES.claude,
        status: installed ? 'ready' : 'missing',
        version: installed ? '2.1.300' : null,
        path: installed ? 'claude.exe' : null,
        installable: opts.installable ?? true,
        message: installed ? null : '没找到 Claude Code',
      }) as EngineInfo,
    install: async onLine => {
      const result = await (opts.install ?? (async () => ({ ok: true, output: '', version: null })))(onLine!)
      if (result.ok) installed = true
      return result
    },
    update: async () => ({ ok: true, output: '', version: null }),
    createSession: () => {
      throw new Error('不开会话')
    },
  }
  const host = new EngineHost({ dataDir: join(root, 'data'), adapters: { claude: adapter }, emit: e => events.push(e) })
  hosts.push(host)
  const jobs = (): EngineJob[] => events.flatMap(e => (e.kind === 'engine_job' ? [e.job] : []))
  return { host, events, jobs }
}

describe('一键安装', () => {
  it('推进度：准备 → 下载 → 安装 → 检测版本 → 完成，装完重新检测并广播', async () => {
    const { host, events, jobs } = setup({
      install: async onLine => {
        onLine('Downloading Claude Code...')
        onLine('Installing Claude Code native build')
        onLine('✔ Claude Code successfully installed!')
        return { ok: true, output: 'installed', version: null }
      },
    })
    const result = await host.installEngine('claude')
    expect(result).toMatchObject({ ok: true, version: '2.1.300' })
    expect(jobs().map(j => j.phase)).toEqual(['prepare', 'download', 'install', 'verify', 'done'])
    expect(jobs().every(j => j.action === 'install' && j.engine === 'claude')).toBe(true)
    expect(jobs()[2]!.line).toBe('Installing Claude Code native build')
    expect(events.some(e => e.kind === 'engines')).toBe(true)
  })

  it('安装器报错：结束在 failed，带最后一行原因，照样重新检测', async () => {
    const { host, events, jobs } = setup({
      install: async () => ({ ok: false, output: 'curl: (6) Could not resolve host', version: null }),
    })
    const result = await host.installEngine('claude')
    expect(result.ok).toBe(false)
    expect(jobs().at(-1)).toMatchObject({ phase: 'failed', error: 'curl: (6) Could not resolve host' })
    expect(events.some(e => e.kind === 'engines')).toBe(true)
  })

  it('同一个引擎安装和更新互斥；检测说不能装时不跑', async () => {
    let finish: () => void = () => undefined
    const { host } = setup({
      install: () => new Promise(resolve => (finish = () => resolve({ ok: true, output: '', version: null }))),
    })
    const first = host.installEngine('claude')
    await new Promise(r => setTimeout(r, 10))
    await expect(host.installEngine('claude')).rejects.toThrow('正在安装')
    await expect(host.updateEngine('claude')).rejects.toThrow('正在安装')
    finish()
    await first
    await expect(host.installEngine('claude')).rejects.toThrow('已经装好了')

    const other = setup({ installable: false })
    await expect(other.host.installEngine('claude')).rejects.toThrow('没找到 Claude Code')
  })

  it('适配器抛错：推 failed 并把错误交给调用方', async () => {
    const { host, jobs } = setup({
      install: async () => {
        throw new Error('没找到 PowerShell / curl')
      },
    })
    await expect(host.installEngine('claude')).rejects.toThrow('没找到 PowerShell')
    expect(jobs().at(-1)).toMatchObject({ phase: 'failed', error: '没找到 PowerShell / curl' })
  })
})

describe('按输出猜阶段', () => {
  it('只往前走，认不出的行算开始下载', () => {
    expect(jobPhase('Checking for updates', 'prepare')).toBe('download')
    expect(jobPhase('Downloading 2.1.300', 'prepare')).toBe('download')
    expect(jobPhase('added 3 packages in 9s', 'download')).toBe('install')
    expect(jobPhase('fetching manifest', 'install')).toBe('install')
    expect(jobPhase('随便一行', 'install')).toBe('install')
  })
})

describe('runStream', () => {
  it('逐行交出输出：\\r 刷新的进度行、颜色都处理掉；结果和 run() 一样', async () => {
    const dir = makeTmp('run-stream')
    roots.push(dir)
    const script = join(dir, 'out.js')
    writeFileSync(
      script,
      [
        "process.stdout.write('\\x1b[32mstep 1\\x1b[0m\\n')",
        "process.stdout.write('10%\\r50%\\r100%\\n')",
        "process.stderr.write('warn line\\n')",
        "process.stdout.write('no newline at end')",
      ].join('\n'),
    )
    const lines: string[] = []
    const r = await runStream({ command: process.execPath, args: [script] }, [], process.env, 10_000, l =>
      lines.push(l),
    )
    expect(r.ok).toBe(true)
    expect(lines).toEqual(expect.arrayContaining(['step 1', '10%', '50%', '100%', 'warn line', 'no newline at end']))
    expect(lines.indexOf('10%')).toBeLessThan(lines.indexOf('100%'))
    expect(outputTail(r, 2)).toBe('no newline at end\nwarn line')
  })

  it('超时结束进程，退出码非 0 算失败', async () => {
    const dir = makeTmp('run-stream')
    roots.push(dir)
    const slow = join(dir, 'slow.js')
    writeFileSync(slow, 'setTimeout(() => {}, 60_000)')
    const r = await runStream({ command: process.execPath, args: [slow] }, [], process.env, 300, () => undefined)
    expect(r).toMatchObject({ ok: false, started: true, error: '超时' })

    const bad = join(dir, 'bad.js')
    writeFileSync(bad, 'process.exit(3)')
    const r2 = await runStream({ command: process.execPath, args: [bad] }, [], process.env, 10_000, () => undefined)
    expect(r2).toMatchObject({ ok: false, error: '退出码 3' })
  })
})
