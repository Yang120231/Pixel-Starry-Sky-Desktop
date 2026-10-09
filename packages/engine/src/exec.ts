// 找可执行文件、跑一次性命令（--version 之类）
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
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

export interface ExecResult {
  ok: boolean
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
    execFile(
      launcher.command,
      [...launcher.args, ...args],
      { env, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
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
