// 引擎启动方式（docs/ui/engine-launch.md）：替换的命令怎么解析、找不到不退回，追加的参数怎么校验、放在哪、改了重启
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCodedError, type HostEvent } from '@pixelsky/protocol'
import { ClaudeAdapter, CodexAdapter, EngineHost } from '../src'
import { IS_WINDOWS, resolveCommand } from '../src/exec'
import { reservedClaudeArg } from '../src/claude/session'
import { reservedCodexArg } from '../src/codex/session'
import { makeTmp, removeTmp } from './helpers/tmp'

const FAKE_CLAUDE = fileURLToPath(new URL('./fakes/fake-claude.mjs', import.meta.url))
const FAKE_CODEX = fileURLToPath(new URL('./fakes/fake-codex.mjs', import.meta.url))

let root: string
let events: HostEvent[]
let hosts: EngineHost[]

beforeEach(() => {
  root = makeTmp('engine-launch')
  events = []
  hosts = []
})

afterEach(async () => {
  await Promise.all(hosts.map(h => h.shutdown()))
  removeTmp(root)
})

async function waitFor<T>(pick: () => T | undefined | null | false, timeoutMs = 10_000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = pick()
    if (v) return v
    if (Date.now() - start > timeoutMs) throw new Error('等待超时')
    await new Promise(r => setTimeout(r, 20))
  }
}

const lines = (file: string): string[][] => {
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l) as string[])
  } catch {
    return []
  }
}

/** 建一个「可执行文件」：Windows 上按扩展名认，其它系统要有执行权限 */
function touch(path: string): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '')
  if (!IS_WINDOWS) chmodSync(path, 0o755)
  return path
}

const codeOf = (err: unknown): string | undefined => parseCodedError((err as Error).message)?.code

/** 测试用的项目目录，放在本次的临时目录里，测试结束一起删掉 */
function projectDir(): string {
  const dir = join(root, `proj-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('替换的命令怎么解析', () => {
  it('绝对路径、PATH 上的命令名；带路径但不是绝对路径的拒绝；找不到的报原因', () => {
    const a = join(root, 'a'),
      b = join(root, 'b')
    const exe = touch(join(a, IS_WINDOWS ? 'my-claude.exe' : 'my-claude'))
    const env = { PATH: [a, b].join(IS_WINDOWS ? ';' : ':') }
    expect(resolveCommand(exe, env)).toEqual({ ok: true, path: exe })
    expect(resolveCommand(`  "${exe}"  `, env)).toEqual({ ok: true, path: exe })
    expect(resolveCommand('my-claude', env)).toEqual({ ok: true, path: exe })
    expect(resolveCommand('bin/my-claude', env)).toEqual({ ok: false, reason: 'notAbsolute' })
    expect(resolveCommand('no-such-command-xyz', env)).toEqual({ ok: false, reason: 'notFound' })
    expect(resolveCommand(join(root, 'nope', 'x'), env)).toEqual({ ok: false, reason: 'notFound' })
  })

  it.runIf(IS_WINDOWS)('Windows：没写扩展名按 PATHEXT 补；只有 .cmd 时给出原因；同名脚本在前时继续找 .exe', () => {
    const a = join(root, 'a'),
      b = join(root, 'b')
    const exe = touch(join(root, 'c', 'tool.exe'))
    expect(resolveCommand(join(root, 'c', 'tool'), {})).toEqual({ ok: true, path: exe })
    const cmd = touch(join(a, 'only.cmd'))
    touch(join(a, 'both.cmd'))
    const both = touch(join(b, 'both.exe'))
    const env = { Path: `${a};${b}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' }
    expect(resolveCommand('only', env)).toEqual({ ok: false, reason: 'script', path: cmd })
    expect(resolveCommand(cmd, env)).toEqual({ ok: false, reason: 'script', path: cmd })
    expect(resolveCommand('both', env)).toEqual({ ok: true, path: both })
  })
})

describe('像素星空自己控制的参数', () => {
  it('Claude Code：每个保留参数都拦下，--x=y 写法和连写的短参数也拦得住', () => {
    const reserved = [
      '-p',
      '--print',
      '--input-format',
      '--output-format',
      '--verbose',
      '--include-partial-messages',
      '--replay-user-messages',
      '--permission-prompt-tool',
      '--allow-dangerously-skip-permissions',
      '--dangerously-skip-permissions',
      '--permission-mode',
      '--model',
      '--effort',
      '-r',
      '--resume',
      '-c',
      '--continue',
      '--session-id',
      '--resume-session-at',
      '--fork-session',
      '--settings',
    ]
    for (const flag of reserved) expect(reservedClaudeArg(['--debug', flag, 'x'])).toBe(flag)
    expect(reservedClaudeArg(['--model=opus'])).toBe('--model')
    expect(reservedClaudeArg(['--settings={}'])).toBe('--settings')
    expect(reservedClaudeArg(['-dp'])).toBe('-p')
    expect(
      reservedClaudeArg([
        '--debug',
        '--add-dir',
        'D:\\work',
        '--append-system-prompt',
        '回答简短',
        '--fallback-model',
        'sonnet',
        '--mcp-config',
        'a.json',
        '--allowedTools',
        'Bash(git:*)',
      ]),
    ).toBeNull()
  })

  it('Codex：--listen 和改平台线路的 -c 拦下，其它 -c 照常', () => {
    expect(reservedCodexArg(['--listen', 'ws://x'])).toBe('--listen')
    expect(reservedCodexArg(['--listen=ws://x'])).toBe('--listen')
    expect(reservedCodexArg(['-c', 'model_provider="x"'])).toBe('-c model_provider')
    expect(reservedCodexArg(['--config', 'model_providers.pixelsky.base_url="x"'])).toBe(
      '-c model_providers.pixelsky.base_url',
    )
    expect(reservedCodexArg(['--config=model_providers={}'])).toBe('-c model_providers')
    expect(reservedCodexArg(['-cmodel_provider=x'])).toBe('-c model_provider')
    expect(reservedCodexArg(['-c', 'model="o3"', '-c', 'model_providers.openai.request_max_retries=3'])).toBeNull()
    expect(reservedCodexArg(['--enable', 'web_search', '-c', 'model_reasoning_summary="detailed"'])).toBeNull()
  })
})

function claudeHost(overridePath?: () => string | null, env?: NodeJS.ProcessEnv, extraEnv: NodeJS.ProcessEnv = {}) {
  const projectsDir = join(root, 'claude-projects')
  const log = join(root, 'claude-argv.log')
  let host: EngineHost | null = null
  const adapter = new ClaudeAdapter({
    launcher: overridePath ? undefined : { command: process.execPath, args: [FAKE_CLAUDE] },
    overridePath,
    projectsDir,
    launchOptions: () => host!.launchOptions('claude'),
    env: env ?? { ...process.env, FAKE_CLAUDE_PROJECTS: projectsDir, FAKE_CLAUDE_LOG: log, ...extraEnv },
  })
  host = new EngineHost({ dataDir: join(root, 'data'), emit: e => events.push(e), adapters: { claude: adapter } })
  hosts.push(host)
  return { host, spawns: () => lines(log) }
}

const turnsDone = (id: string): number =>
  events.filter(e => e.kind === 'session' && e.sessionId === id && e.event.type === 'turn_completed').length

describe('Claude Code：追加参数', () => {
  it('参数放在最后；改了参数，已开始的会话在下一条消息前重启并接上；清空后不再带', async () => {
    const { host, spawns } = claudeHost()
    const s = host.createSession({ projectId: host.addProject(projectDir()).id })
    await host.send(s.id, '第一条')
    await waitFor(() => turnsDone(s.id) === 1)
    expect(spawns()).toHaveLength(1)

    const config = await host.setEngineConfig('claude', { args: ['--debug', '--add-dir', 'D:\\My Work'] })
    expect(config.claude.args).toEqual(['--debug', '--add-dir', 'D:\\My Work'])
    await host.send(s.id, '第二条')
    await waitFor(() => turnsDone(s.id) === 2)
    // 改了参数重新检测时握手一次（§9.2），再加上会话重启
    expect(spawns()).toHaveLength(3)
    const argv = spawns().at(-1)!
    expect(argv).toContain('--resume')
    expect(argv.slice(-3)).toEqual(['--debug', '--add-dir', 'D:\\My Work'])

    // 输出风格的握手也带上参数
    await host.engineCatalog('claude', true)
    expect(spawns().at(-1)!.slice(-3)).toEqual(['--debug', '--add-dir', 'D:\\My Work'])

    await host.setEngineConfig('claude', { args: [] })
    expect(host.engineConfig().claude.args).toEqual([])
    await host.send(s.id, '第三条')
    await waitFor(() => turnsDone(s.id) === 3)
    expect(spawns().at(-1)).not.toContain('--debug')
  })

  it('不允许的参数、第一个不是选项、格式不对的都不保存，报带代码的原因', async () => {
    const { host } = claudeHost()
    await expect(host.setEngineConfig('claude', { args: ['--model', 'opus'] })).rejects.toThrow()
    expect(await host.setEngineConfig('claude', { args: ['--resume=x'] }).catch(codeOf)).toBe('launch.reserved')
    expect(await host.setEngineConfig('claude', { args: ['hello'] }).catch(codeOf)).toBe('launch.firstArg')
    expect(await host.setEngineConfig('claude', { args: 'oops' as never }).catch(codeOf)).toBe('launch.invalidArgs')
    expect(await host.setEngineConfig('claude', { args: Array(101).fill('-x') }).catch(codeOf)).toBe(
      'launch.argsTooLong',
    )
    expect(host.engineConfig().claude.args).toEqual([])
  })

  it('它不认的参数：检测时握手看得到原因（仍算可用）；参数正常时握手结果当输出风格缓存，不另起进程', async () => {
    const { host, spawns } = claudeHost()
    await host.setEngineConfig('claude', { args: ['--fake-bad-arg'] })
    let [info] = await host.engines()
    expect(info.status).toBe('ready')
    expect(info.launchError).toBe("error: unknown option '--fake-bad-arg'\n(Did you mean --fake-good-arg?)")

    await host.setEngineConfig('claude', { args: ['--debug'] })
    ;[info] = await host.engines()
    expect(info.launchError).toBeUndefined()
    let before = spawns().length
    await host.engineCatalog('claude')
    expect(spawns()).toHaveLength(before)
    // 检测还在握手时要输出风格列表：等它做完用它的结果，只启动一次
    before = spawns().length
    await Promise.all([host.engines(true), host.engineCatalog('claude')])
    expect(spawns()).toHaveLength(before + 1)

    // 没追加参数时检测不握手
    before = spawns().length
    await host.setEngineConfig('claude', { args: [] })
    expect(spawns()).toHaveLength(before)
  })
})

describe('Claude Code：重启时进程起不来（§9.1）', () => {
  it('不当成会话记录丢了：不提示「没带过去」，会话 id 和待执行的回退都留着，好了以后照常接上', async () => {
    const fail = join(root, 'start-fail')
    const { host, spawns } = claudeHost(undefined, undefined, {
      FAKE_CLAUDE_CHAIN: '1',
      FAKE_CLAUDE_CHAIN_LOG: join(root, 'chain.log'),
      FAKE_CLAUDE_START_FAIL_FILE: fail,
    })
    const s = host.createSession({ projectId: host.addProject(projectDir()).id })
    for (const [i, text] of ['一', '二'].entries()) {
      await host.send(s.id, { text, clientMessageId: `m${i}` })
      await waitFor(() => turnsDone(s.id) === i + 1)
    }
    // 回退会关掉进程，下一条消息要重新启动并带上回退点
    const second = host.open(s.id).items.find(i => i.kind === 'user' && i.text === '二')!
    await host.rewind(s.id, second.id)
    const { engineSessionId, pendingRewind } = host.open(s.id).record
    expect(pendingRewind).toBeTruthy()

    writeFileSync(fail, '')
    await host.send(s.id, { text: '三', clientMessageId: 'm2' })
    await waitFor(() => turnsDone(s.id) === 3)
    const notices = () => host.open(s.id).items.flatMap(i => (i.kind === 'notice' ? [i.text] : []))
    expect(notices().some(t => t.includes('fake startup failure'))).toBe(true)
    expect(notices().some(t => t.includes('没有带过去'))).toBe(false)
    expect(host.open(s.id).record).toMatchObject({ engineSessionId, pendingRewind })

    rmSync(fail)
    await host.send(s.id, { text: '四', clientMessageId: 'm3' })
    await waitFor(() => turnsDone(s.id) === 4)
    const argv = spawns().at(-1)!
    expect(argv[argv.indexOf('--resume') + 1]).toBe(engineSessionId)
    expect(argv).toContain(`--resume-session-at=${pendingRewind}`)
    expect(host.open(s.id).record.pendingRewind).toBeNull()
    expect(notices().some(t => t.includes('没有带过去'))).toBe(false)
  })
})

describe('Claude Code：替换的命令', () => {
  it('找不到的命令不保存；已保存的命令找不到时显示为不可用，不退回自带程序', async () => {
    const { host } = claudeHost()
    expect(await host.setEngineConfig('claude', { path: 'no-such-claude-xyz' }).catch(codeOf)).toBe('launch.notFound')
    expect(host.engineConfig().claude.path).toBeNull()

    const { host: other } = claudeHost(() => 'no-such-claude-xyz')
    const [info] = await other.engines(true)
    expect(info).toMatchObject({ id: 'claude', status: 'missing', launch: 'custom', path: null })
    expect(parseCodedError(info.message)).toEqual({
      code: 'launch.notFound',
      params: { command: 'no-such-claude-xyz' },
    })
  })

  it('PATH 上的命令名解析成完整路径；读不出版本号时版本未知，照常可用；启动不了的报无法运行', async () => {
    // 用 node 冒充替换后的程序：node --version 输出 v24.x，auth status 跑不了就当已登录
    const bin = dirname(process.execPath)
    const { host } = claudeHost(() => 'node', { PATH: bin })
    const [info] = await host.engines(true)
    expect(info).toMatchObject({ status: 'ready', launch: 'custom', path: process.execPath })

    // 不认 --version 的系统程序（Windows 的 whoami 报参数不对，其它系统的 true 什么都不输出）
    const sys = IS_WINDOWS ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') : '/usr/bin:/bin'
    const { host: wrapped } = claudeHost(() => (IS_WINDOWS ? 'whoami' : 'true'), { PATH: sys })
    const [unknown] = await wrapped.engines(true)
    expect(unknown).toMatchObject({ status: 'ready', launch: 'custom', version: null })

    // 不是合法程序的「可执行文件」：启动不了
    const wrapper = touch(join(root, IS_WINDOWS ? 'wrap.exe' : 'wrap'))
    const { host: broken } = claudeHost(() => wrapper, { PATH: bin })
    const [bad] = await broken.engines(true)
    expect(bad).toMatchObject({ status: 'error', launch: 'custom' })
  })
})

describe('Codex：追加参数', () => {
  it('自定义 API 会话用独立的 pixelsky-custom provider 指向本机网关，清掉用户的 OPENAI_*，重试次数跟着它走', async () => {
    const argvLog = join(root, 'codex-argv.log')
    const adapter = new CodexAdapter({
      launcher: { command: process.execPath, args: [FAKE_CODEX] },
      env: {
        ...process.env,
        OPENAI_API_KEY: 'sk-local',
        FAKE_CODEX_ARGV: argvLog,
        FAKE_CODEX_LOG: join(root, 'rpc.jsonl'),
      },
      launchOptions: () => ({ askQuestions: true, steeringValidated: true }),
      sessionEnv: r =>
        r.provider
          ? { PIXELSKY_CODEX_BASE_URL: 'http://127.0.0.1:1234/v1', PIXELSKY_CODEX_TOKEN: 'loopback-only' }
          : {},
    })
    const host = new EngineHost({
      dataDir: join(root, 'data'),
      emit: e => events.push(e),
      adapters: { codex: adapter },
    })
    hosts.push(host)
    host.setRetrySettings(2)
    const s = host.createSession({
      projectId: host.addProject(projectDir()).id,
      engine: 'codex',
      model: 'gpt-5',
      provider: { id: 'p1' },
      permissionMode: 'ask',
    })
    await host.send(s.id, '你好')
    await waitFor(() => turnsDone(s.id) === 1)
    const argv = lines(argvLog).at(-1)!.join(' ')
    expect(argv).toContain('model_provider="pixelsky-custom"')
    expect(argv).toContain('model_providers.pixelsky-custom.base_url="http://127.0.0.1:1234/v1"')
    expect(argv).toContain('model_providers.pixelsky-custom.env_key="PIXELSKY_CODEX_TOKEN"')
    expect(argv).toContain('model_providers.pixelsky-custom.request_max_retries=2')
    expect(argv).not.toContain('sk-local')
    expect(argv).not.toContain('model_providers.pixelsky.')
  })

  it('参数放在 app-server --listen stdio:// 后面、像素星空自己的 -c 前面；检测握手也带上', async () => {
    const argvLog = join(root, 'codex-argv.log')
    let host: EngineHost | null = null
    const adapter = new CodexAdapter({
      launcher: { command: process.execPath, args: [FAKE_CODEX] },
      env: { ...process.env, FAKE_CODEX_ARGV: argvLog, FAKE_CODEX_LOG: join(root, 'rpc.jsonl') },
      launchOptions: () => {
        const o = host!.launchOptions('codex')
        return { askQuestions: o.askQuestions, args: o.args, steeringValidated: true }
      },
    })
    host = new EngineHost({ dataDir: join(root, 'data'), emit: e => events.push(e), adapters: { codex: adapter } })
    hosts.push(host)
    host.setRetrySettings(2)
    await expect(host.setEngineConfig('codex', { args: ['-c', 'model_provider="x"'] })).rejects.toThrow()
    await host.setEngineConfig('codex', { args: ['-c', 'model_reasoning_summary="detailed"'] })
    // 改了参数会重新检测：检测握手带上参数
    expect(lines(argvLog).at(-1)).toEqual([
      'app-server',
      '--listen',
      'stdio://',
      '-c',
      'model_reasoning_summary="detailed"',
    ])

    const s = host.createSession({
      projectId: host.addProject(projectDir()).id,
      engine: 'codex',
      model: 'fake-codex',
      effort: 'high',
      permissionMode: 'ask',
    })
    await host.send(s.id, '你好')
    await waitFor(() => turnsDone(s.id) === 1)
    const argv = lines(argvLog).at(-1)!
    const user = argv.indexOf('model_reasoning_summary="detailed"')
    expect(argv.slice(0, 3)).toEqual(['app-server', '--listen', 'stdio://'])
    expect(user).toBe(4)
    expect(argv.findIndex(a => a.includes('request_max_retries'))).toBeGreaterThan(user)

    // 它不认的参数让进程起不来：检测时显示为出错，原因是 Codex 自己的报错
    await host.setEngineConfig('codex', { args: ['--fake-bad-arg'] })
    const [, codex] = await host.engines()
    expect(codex).toMatchObject({ status: 'error' })
    expect(codex.message).toBe("error: unexpected argument '--fake-bad-arg' found\nUsage: codex app-server [OPTIONS]")
    // 追加了参数：原因也给「启动」卡片显示（§9.3）
    expect(codex.launchError).toBe(codex.message)
  })
})
