import type { CheckInputOptions, CheckReport } from '../lib/check'

export interface CliIo {
  out(s: string): void
  err(s: string): void
  cwd: string
  env: NodeJS.ProcessEnv
  isTTY: boolean
  locale: string
}

/** 测试用的注入点：线上入口不传。让测试能不起 worker、能模拟工具出错和写文件失败 */
export interface CliHooks {
  runner?: 'inline' | 'worker'
  checkInput?: (path: string, opts: CheckInputOptions) => Promise<CheckReport>
  writeFile?: (path: string, bytes: Uint8Array) => Promise<void>
}

export function nodeIo(): CliIo {
  let locale = ''
  try {
    locale = Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    // 没有 Intl 就按英文
  }
  return {
    out: s => void process.stdout.write(s),
    err: s => void process.stderr.write(s),
    cwd: process.cwd(),
    env: process.env,
    isTTY: process.stdout.isTTY === true,
    locale,
  }
}
