// 跑 gh（GitHub CLI）：先用 resolveCommand 找到绝对路径再用 execFile 直接启动（不经过 shell），
// cwd 设成用户主目录并带 NoDefaultCurrentDirectoryInExePath=1，当前目录里的同名程序不会被执行。
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { resolveCommand } from '@pixelsky/engine'

export interface GhResult {
  /** 退出码；没启动起来或超时为 null */
  code: number | null
  stdout: string
  stderr: string
  /** 没装 gh（或只找到不能直接启动的脚本） */
  missing: boolean
  timedOut: boolean
}

export type GhRunner = (args: string[]) => Promise<GhResult>

export const GH_TIMEOUT_MS = 15_000

export function ghEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    NoDefaultCurrentDirectoryInExePath: '1',
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    NO_COLOR: '1',
  }
}

export function createGhRunner(opts: { env?: () => NodeJS.ProcessEnv; cwd?: string; timeout?: number } = {}): GhRunner {
  return args =>
    new Promise(resolve => {
      const env = ghEnv(opts.env?.() ?? process.env)
      const found = resolveCommand('gh', env)
      if (!found.ok) {
        resolve({ code: null, stdout: '', stderr: '', missing: true, timedOut: false })
        return
      }
      try {
        execFile(
          found.path,
          args,
          {
            cwd: opts.cwd ?? homedir(),
            env,
            timeout: opts.timeout ?? GH_TIMEOUT_MS,
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024,
            encoding: 'utf8',
          },
          (err, stdout, stderr) => {
            const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null
            resolve({
              code: !e ? 0 : typeof e.code === 'number' ? e.code : null,
              stdout: String(stdout ?? ''),
              stderr: String(stderr ?? ''),
              missing: e?.code === 'ENOENT',
              timedOut: Boolean(e?.killed),
            })
          },
        )
      } catch (error) {
        // 不是合法程序的文件（例如 Windows 上的 EFTYPE）会同步抛出
        resolve({ code: null, stdout: '', stderr: (error as Error).message, missing: true, timedOut: false })
      }
    })
}
