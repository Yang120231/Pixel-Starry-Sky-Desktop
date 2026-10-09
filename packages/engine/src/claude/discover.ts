// 找 Claude Code 可执行文件、检测版本和登录状态（docs/engines.md §7）
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EngineInfo } from '@pixelsky/protocol'
import type { Launcher } from '../adapter'
import { engineBase } from '../registry'
import { IS_WINDOWS, dirsOnPath, findOnPath, isFile, run, versionAtLeast } from '../exec'

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
 * 按顺序找：用户指定的路径 → PIXELSKY_CLAUDE_BIN → PATH → 官方安装器位置 → npm 全局安装。
 * Windows 上只直接启动 .exe；找到 npm 的 .cmd 垫片时，改用 node 跑包里的 cli.js（不经过 cmd.exe，参数不会被弄坏）。
 */
export function findClaude(overridePath: string | null, env: NodeJS.ProcessEnv): Launcher | null {
  const home = homedir()
  const exeCandidates = [
    overridePath,
    env.PIXELSKY_CLAUDE_BIN,
    findOnPath(EXE, env),
    join(home, '.local', 'bin', EXE),
    join(home, '.claude', 'local', EXE),
    IS_WINDOWS && env.APPDATA
      ? join(env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', EXE)
      : null,
  ]
  for (const p of exeCandidates) {
    if (p && isFile(p) && !/\.(cmd|bat|ps1)$/i.test(p)) return { command: p, args: [] }
  }
  // npm 全局安装（旧版是 node 脚本）：claude.cmd 旁边的 node_modules/@anthropic-ai/claude-code/cli.js
  if (IS_WINDOWS) {
    const node = findOnPath('node.exe', env)
    for (const dir of dirsOnPath('claude.cmd', env)) {
      const cli = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
      if (node && isFile(cli)) return { command: node, args: [cli] }
    }
  }
  return null
}

function base(): Omit<EngineInfo, 'status' | 'version' | 'path' | 'message'> {
  return engineBase('claude')
}

export async function discoverClaude(overridePath: string | null, env: NodeJS.ProcessEnv): Promise<ClaudeDiscovery> {
  const launcher = findClaude(overridePath, env)
  if (!launcher) {
    return {
      launcher: null,
      projectsDir: null,
      info: {
        ...base(),
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
  if (!ver.ok || !version) {
    return {
      launcher,
      projectsDir: null,
      info: {
        ...base(),
        status: 'error',
        version: null,
        path,
        message: `无法运行 Claude Code：${ver.error ?? ver.stderr.trim().slice(0, 200)}`,
      },
    }
  }
  if (!versionAtLeast(version, CLAUDE_MIN_VERSION)) {
    return {
      launcher,
      projectsDir: null,
      info: {
        ...base(),
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
        ...base(),
        status: 'unauthenticated',
        version,
        path,
        message: '还没登录 Claude Code：在终端运行 claude auth login',
      },
    }
  }
  return { launcher, projectsDir, info: { ...base(), status: 'ready', version, path, message: null } }
}
