import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import type { WslDistro } from '../../shared/types/machines'

export type { WslDistro }

// 旧版 wsl.exe 不认 WSL_UTF8，输出是 UTF-16LE，所以两种都要认；UTF-8 文本里不会有 0 字节，
// 有就是 UTF-16（中文占多数时按「一半以上是 0」会漏判）
export function decodeWslOutput(buf: Buffer): string {
  let text: string
  const utf16 = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe
  if (utf16 || buf.includes(0)) {
    text = buf.toString('utf16le')
  } else {
    text = buf.toString('utf8')
  }
  return text.replace(/^\uFEFF/, '').replace(/\r/g, '')
}

const STATES: Record<string, WslDistro['state']> = {
  running: 'running',
  stopped: 'stopped',
  installing: 'installing',
  converting: 'converting',
  正在运行: 'running',
  已停止: 'stopped',
  正在安装: 'installing',
  正在转换: 'converting',
}

// 不按表头单词定位（会被翻译）：从右往左取版本、状态，其余是名字
export function parseWslList(text: string): WslDistro[] {
  const result: WslDistro[] = []
  let headerSkipped = false
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) continue
    if (!headerSkipped) {
      headerSkipped = true
      continue
    }
    const isDefault = /^\s*\*/.test(raw)
    const tokens = raw
      .replace(/^\s*\*?/, '')
      .trim()
      .split(/\s+/)
    if (tokens.length < 3) continue
    const version = Number(tokens[tokens.length - 1])
    if (version !== 1 && version !== 2) continue
    const stateWord = tokens[tokens.length - 2]
    const state = STATES[stateWord.toLowerCase()] ?? 'unknown'
    result.push({ name: tokens.slice(0, -2).join(' '), state, version, isDefault })
  }
  return result
}

export const HIDDEN_DISTROS: RegExp[] = [
  /^docker-desktop$/i,
  /^docker-desktop-data$/i,
  /^rancher-desktop/i,
  /^podman-machine-/i,
]

export function visibleDistros(list: WslDistro[]): WslDistro[] {
  return list.filter(d => !HIDDEN_DISTROS.some(re => re.test(d.name)))
}

// 发行版名可能带 . _，不能直接放进资源 ID
export function wslMachineId(distro: string): string {
  return 'wsl-' + createHash('sha256').update(distro.toLowerCase()).digest('hex').slice(0, 12)
}

// 绝不执行 wsl --shutdown / --terminate：会把 Docker Desktop 一起关掉
function runWsl(args: string[]): Promise<Buffer | null> {
  const exe = join(process.env.SystemRoot ?? String.raw`C:\Windows`, 'System32', 'wsl.exe')
  return new Promise(resolve => {
    execFile(
      exe,
      args,
      { encoding: 'buffer', timeout: 5000, windowsHide: true, env: { ...process.env, WSL_UTF8: '1' } },
      (error, stdout) => resolve(error ? null : stdout),
    )
  })
}

export async function listWsl(run: (args: string[]) => Promise<Buffer | null> = runWsl): Promise<WslDistro[] | null> {
  if (process.platform !== 'win32') return []
  const out = await run(['--list', '--verbose'])
  // null = wsl.exe 超时或出错，和「确实没有发行版」要分开，免得偶发失败把机器全藏起来
  return out ? parseWslList(decodeWslOutput(out)) : null
}
