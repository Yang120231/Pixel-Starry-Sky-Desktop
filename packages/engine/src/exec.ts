// 找可执行文件、跑一次性命令（--version 之类）
import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, extname, isAbsolute, join } from 'node:path'
import type { Launcher } from './adapter'

export const IS_WINDOWS = process.platform === 'win32'

export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** 在 PATH 里找某个文件名（Windows 上要带扩展名，例如 claude.exe） */
export function findOnPath(fileName: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.PATH ?? env.Path ?? ''
  for (const dir of raw.split(delimiter)) {
    if (!dir) continue
    const p = join(dir.replace(/^"|"$/g, ''), fileName)
    if (existsSync(p) && isFile(p)) return p
  }
  return null
}

/** PATH 里所有包含某个文件的目录 */
export function dirsOnPath(fileName: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.PATH ?? env.Path ?? ''
  return raw
    .split(delimiter)
    .filter(Boolean)
    .map(d => d.replace(/^"|"$/g, ''))
    .filter(d => isFile(join(d, fileName)))
}

/** PATH 环境变量的值（Windows 上键名大小写不定，复制出来的环境对象不再忽略大小写） */
function pathValue(env: NodeJS.ProcessEnv): string {
  const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH')
  return (key ? env[key] : undefined) ?? ''
}

/** 能直接启动的文件：Windows 上只有 .exe / .com（脚本要经过 cmd.exe），其它系统要有执行权限 */
function launchable(p: string): boolean {
  if (IS_WINDOWS) return /\.(?:exe|com)$/i.test(p)
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** 用户替换的命令解析结果（docs/ui/engine-launch.md §3） */
export type ResolvedCommand =
  | { ok: true; path: string }
  | { ok: false; reason: 'notFound' | 'notAbsolute' }
  /** 找到了，但不能直接启动（Windows 上的 .cmd / .bat / .ps1 等）；适配器可以再试着从 npm 垫片找到真正的程序 */
  | { ok: false; reason: 'script'; path: string }

/**
 * 解析用户替换的命令：带路径分隔符的按绝对路径找（~ 指用户目录），否则在 PATH 上找。
 * Windows 上没写扩展名时按 PATHEXT 补；PATH 上同名的脚本排在 .exe 前面时，继续往后找 .exe。
 */
export function resolveCommand(command: string, env: NodeJS.ProcessEnv = process.env): ResolvedCommand {
  let c = command.trim().replace(/^"(.*)"$/, '$1')
  if (c === '~' || c.startsWith('~/') || c.startsWith('~\\')) c = join(homedir(), c.slice(1))
  const exts = IS_WINDOWS
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .map(e => e.trim().toLowerCase())
        .filter(e => e.startsWith('.'))
    : []
  const variants = (base: string): string[] =>
    !IS_WINDOWS ? [base] : [...(extname(base) ? [base] : []), ...exts.map(e => base + e)]
  let candidates: string[] = []
  if (/[\\/]/.test(c)) {
    if (!isAbsolute(c)) return { ok: false, reason: 'notAbsolute' }
    candidates = variants(c)
  } else if (c) {
    for (const dir of pathValue(env).split(delimiter))
      if (dir) candidates.push(...variants(join(dir.replace(/^"|"$/g, ''), c)))
  }
  const found = candidates.filter(isFile)
  const path = found.find(launchable)
  if (path) return { ok: true, path }
  return found.length ? { ok: false, reason: 'script', path: found[0] } : { ok: false, reason: 'notFound' }
}

export interface ExecResult {
  ok: boolean
  /** 进程起来了（退出码非 0、超时也算）；false 是程序根本启动不了 */
  started: boolean
  stdout: string
  stderr: string
  /** 启动失败或超时时的错误说明 */
  error: string | null
}

/** 跑一次性命令，不经过 shell，不弹窗口 */
export function run(
  launcher: Launcher,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 20_000,
): Promise<ExecResult> {
  return new Promise(resolve => {
    try {
      execFile(
        launcher.command,
        [...launcher.args, ...args],
        { env, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout, stderr) => {
          resolve({
            ok: !err,
            started: !err || err.killed || typeof (err as { code?: unknown }).code === 'number',
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
            error: err
              ? (err as NodeJS.ErrnoException).code === 'ETIMEDOUT' || err.killed
                ? '超时'
                : err.message
              : null,
          })
        },
      )
    } catch (err) {
      // 不是合法程序的文件（例如 Windows 上的 EFTYPE）会同步抛出，而不是走回调
      resolve({ ok: false, started: false, stdout: '', stderr: '', error: (err as Error).message })
    }
  })
}

/** 比较版本号 a 是否 >= b（只看数字部分） */
export function versionAtLeast(a: string, b: string): boolean {
  const pa = a.split('.').map(x => parseInt(x, 10) || 0)
  const pb = b.split('.').map(x => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return true
}
