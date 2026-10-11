// 找 Claude Code 可执行文件、检测版本和登录状态（docs/engines.md §7）
import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { codedError, type EngineInfo } from '@pixelsky/protocol'
import type { Launcher } from '../adapter'
import { engineBase } from '../registry'
import { IS_WINDOWS, dirsOnPath, findOnPath, isFile, resolveCommand, run, versionAtLeast } from '../exec'

/** 用到的参数（--permission-prompt-tool stdio、--effort、control 协议的 apply_flag_settings 等）在这个版本之后都有 */
export const CLAUDE_MIN_VERSION = '2.1.0'

const EXE = IS_WINDOWS ? 'claude.exe' : 'claude'

export interface ClaudeDiscovery {
  info: EngineInfo
  launcher: Launcher | null
  /** claude auth status 报告的会话记录目录（~/.claude/projects），恢复会话时用 */
  projectsDir: string | null
}

/**
 * 自带程序，按顺序找：PIXELSKY_CLAUDE_BIN → PATH → 官方安装器位置 → npm 全局安装。
 * Windows 上只直接启动 .exe；找到 npm 的 .cmd 垫片时，改用 node 跑包里的 cli.js（不经过 cmd.exe，参数不会被弄坏）。
 */
export function findClaude(env: NodeJS.ProcessEnv): Launcher | null {
  const home = homedir()
  const exeCandidates = [
    env.PIXELSKY_CLAUDE_BIN,
    findOnPath(EXE, env),
    join(home, '.local', 'bin', EXE),
    join(home, '.claude', 'local', EXE),
    IS_WINDOWS && env.APPDATA
      ? join(env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', EXE)
      : null,
    // macOS / Linux：Homebrew、npm 全局（从程序坞启动、没读到登录 shell 的 PATH 时）
    ...(IS_WINDOWS
      ? []
      : ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', join(home, '.npm-global', 'bin', 'claude')]),
  ]
  for (const p of exeCandidates) {
    if (p && isNative(p) && !/\.(cmd|bat|ps1)$/i.test(p)) return { command: p, args: [] }
  }
  return IS_WINDOWS ? npmOnPath(env) : null
}

/** npm 全局安装：PATH 上 claude.cmd 所在的目录（npm 默认的 %APPDATA%\npm，或 nvm-windows / nvm4w、fnm、Volta 等换过的位置） */
export function npmOnPath(env: NodeJS.ProcessEnv): Launcher | null {
  for (const dir of dirsOnPath('claude.cmd', env)) {
    const found = npmClaude(join(dir, 'node_modules', '@anthropic-ai', 'claude-code'), env)
    if (found) return found
  }
  return null
}

/**
 * 不是 npm 包里占位的小脚本：新版 npm 包的 bin/claude.exe 装完后由 postinstall 换成原生程序（上百 MB），
 * 没跑 postinstall（--ignore-scripts）时还是 500 字节的占位脚本，启动只会报错
 */
function isNative(path: string): boolean {
  try {
    const s = statSync(path)
    // macOS / Linux 上 PATH 里的 claude 是指向 bin/claude.exe 的链接，按实际文件判断
    return s.isFile() && (!/claude\.exe$/i.test(realpathSync(path)) || s.size > 64 * 1024)
  } catch {
    return false
  }
}

/**
 * npm 装的 Claude Code 包目录 → 启动方式。新版（2.1.x 起）：bin/claude.exe 是原生程序；
 * 没跑 postinstall 时直接用对应平台的可选依赖包里的原生程序；旧版：用 node 跑包里的 cli.js
 */
export function npmClaude(pkg: string, env: NodeJS.ProcessEnv): Launcher | null {
  // 包里的命令在各系统上都叫 bin/claude.exe（package.json 的 bin）
  const exe = join(pkg, 'bin', 'claude.exe')
  if (isNative(exe)) return { command: exe, args: [] }
  const platform = `claude-code-${process.platform}-${process.arch}`
  for (const native of [join(pkg, 'node_modules', '@anthropic-ai', platform, EXE), join(pkg, '..', platform, EXE)])
    if (isNative(native)) return { command: native, args: [] }
  const cli = join(pkg, 'cli.js')
  const node = findOnPath(IS_WINDOWS ? 'node.exe' : 'node', env)
  if (node && isFile(cli)) return { command: node, args: [cli] }
  return null
}

/**
 * 用户替换的命令（docs/ui/engine-launch.md §3）：绝对路径或 PATH 上的命令名。
 * 指到 npm 的 .cmd 垫片时，和自带程序一样换成包里的 claude.exe 或用 node 跑 cli.js。
 * 找不到时给出原因（带代码的错误），不退回自带程序。
 */
export function customClaude(command: string, env: NodeJS.ProcessEnv): { launcher: Launcher } | { error: string } {
  const r = resolveCommand(command, env)
  if (r.ok) return { launcher: { command: r.path, args: [] } }
  if (r.reason === 'script') {
    if (/\.cmd$/i.test(r.path)) {
      const launcher = npmClaude(join(dirname(r.path), 'node_modules', '@anthropic-ai', 'claude-code'), env)
      if (launcher) return { launcher }
    }
    return { error: codedError('launch.script', { path: r.path }).message }
  }
  return { error: codedError(`launch.${r.reason}`, { command: command.trim() }).message }
}

function base(launch: EngineInfo['launch']): Omit<EngineInfo, 'status' | 'version' | 'path' | 'message'> {
  return { ...engineBase('claude'), launch }
}

/** command 为用户替换的命令，null 用自带程序 */
export async function discoverClaude(command: string | null, env: NodeJS.ProcessEnv): Promise<ClaudeDiscovery> {
  const custom = command ? customClaude(command, env) : null
  const launch = custom ? 'custom' : 'stock'
  if (custom && 'error' in custom)
    return {
      launcher: null,
      projectsDir: null,
      info: { ...base(launch), status: 'missing', version: null, path: null, message: custom.error },
    }
  const launcher = custom ? custom.launcher : findClaude(env)
  if (!launcher) {
    return {
      launcher: null,
      projectsDir: null,
      info: {
        ...base(launch),
        status: 'missing',
        version: null,
        path: null,
        message: IS_WINDOWS
          ? '没找到 Claude Code。安装：在 PowerShell 运行 irm https://claude.ai/install.ps1 | iex'
          : '没找到 Claude Code。安装：在终端运行 curl -fsSL https://claude.ai/install.sh | bash',
      },
    }
  }
  const path = launcher.args[0] ?? launcher.command

  const ver = await run(launcher, ['--version'], env)
  const version = /(\d+\.\d+\.\d+)/.exec(ver.stdout)?.[1] ?? null
  // 替换后的程序（套壳脚本等）可能不支持 --version：能启动就照常用，版本未知，不按最低版本拦截
  const unknownVersion = custom !== null && ver.started && !version
  if (!unknownVersion && (!ver.ok || !version)) {
    return {
      launcher,
      projectsDir: null,
      info: {
        ...base(launch),
        status: 'error',
        version: null,
        path,
        message: `无法运行 Claude Code：${ver.error ?? ver.stderr.trim().slice(0, 200)}`,
      },
    }
  }
  if (version && !versionAtLeast(version, CLAUDE_MIN_VERSION)) {
    return {
      launcher,
      projectsDir: null,
      info: {
        ...base(launch),
        status: 'outdated',
        version,
        path,
        message: `版本太低（需要 ${CLAUDE_MIN_VERSION} 以上）：在终端运行 claude update`,
      },
    }
  }

  // 登录状态：老版本没有 auth status，查不到就当作已登录，真正出错时会在对话里提示
  let loggedIn = true
  let projectsDir: string | null = null
  const auth = await run(launcher, ['auth', 'status', '--json'], env)
  try {
    const o = JSON.parse(auth.stdout) as { loggedIn?: boolean; projectsDirectory?: string }
    if (typeof o.loggedIn === 'boolean') loggedIn = o.loggedIn
    if (typeof o.projectsDirectory === 'string') projectsDir = o.projectsDirectory
  } catch {
    // 忽略
  }
  // 用环境变量配置了 Key 或中转的用户，auth status 可能显示未登录，但实际能用
  if (!loggedIn && !env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) {
    return {
      launcher,
      projectsDir,
      info: {
        ...base(launch),
        status: 'unauthenticated',
        version,
        path,
        message: '还没登录 Claude Code：在终端运行 claude auth login',
      },
    }
  }
  return { launcher, projectsDir, info: { ...base(launch), status: 'ready', version, path, message: null } }
}
