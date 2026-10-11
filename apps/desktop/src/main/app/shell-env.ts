// macOS / Linux 从程序坞、Finder、桌面菜单启动时，环境变量是系统给的最小一套（PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin），
// 用 Homebrew、npm、nvm 装的 claude / codex / git / node 都找不到。启动时问一次用户的登录 shell，把 PATH 等补回来（VS Code 也这么做）。
import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'

const MARK = '__PIXELSKY_ENV__'
/** 只补这几样：其余的（终端会话、SSH 代理等）是启动 shell 时临时的，不带进来 */
const KEEP = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'NVM_DIR', 'NVM_BIN', 'VOLTA_HOME', 'PNPM_HOME', 'HOMEBREW_PREFIX']

/** `env -0` 的输出（两个标记之间）→ 变量表 */
export function parseEnv(output: string): Record<string, string> {
  const start = output.indexOf(MARK),
    end = output.lastIndexOf(MARK)
  if (start < 0 || end <= start) return {}
  const env: Record<string, string> = {}
  for (const entry of output.slice(start + MARK.length, end).split('\0')) {
    const eq = entry.indexOf('=')
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1)
  }
  return env
}

/** 合并：PATH 用登录 shell 的、原来有而它没有的目录接在后面；其余的原来没有才补 */
export function mergeEnv(current: NodeJS.ProcessEnv, shell: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of KEEP) {
    const value = shell[key]
    if (!value) continue
    if (key === 'PATH') {
      const dirs = value.split(':').filter(Boolean)
      for (const dir of (current.PATH ?? '').split(':')) if (dir && !dirs.includes(dir)) dirs.push(dir)
      out.PATH = dirs.join(':')
    } else if (!current[key]) out[key] = value
  }
  return out
}

/** 从终端里启动的已经是完整环境，不用再问；开发模式也是从终端起的 */
function needed(env: NodeJS.ProcessEnv): boolean {
  if (process.platform === 'win32' || env.PIXELSKY_SKIP_SHELL_ENV) return false
  return !env.TERM_PROGRAM && !env.VSCODE_CWD && !(env.TERM && env.TERM !== 'dumb' && env.SHLVL)
}

export function loadShellEnv(timeoutMs = 5000): Promise<void> {
  if (!needed(process.env)) return Promise.resolve()
  const shell =
    process.env.SHELL && isAbsolute(process.env.SHELL)
      ? process.env.SHELL
      : process.platform === 'darwin'
        ? '/bin/zsh'
        : '/bin/bash'
  return new Promise(done => {
    // -i -l：读 .zprofile / .zshrc / .bash_profile / .bashrc 这些用户改 PATH 的地方；读不完（卡在交互提示）就算了
    execFile(
      shell,
      ['-ilc', `printf '${MARK}'; command env -0; printf '${MARK}'`],
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, PIXELSKY_SHELL_ENV: '1', DISABLE_AUTO_UPDATE: 'true', ZSH_TMUX_AUTOSTARTED: 'true' },
      },
      (_err, stdout) => {
        try {
          Object.assign(process.env, mergeEnv(process.env, parseEnv(stdout ?? '')))
        } catch {
          // 读不到就用原来的环境
        }
        done()
      },
    )
  })
}
