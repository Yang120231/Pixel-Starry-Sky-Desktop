// 找像素星空命令行（docs/own-cli.md §3）：用户在设置里替换的命令 → 环境变量 PIXELSKY_CLI_BIN → 自带的入口（桌面端传 bundledCli）→ PATH 上的 pixelsky
import { extname } from 'node:path'
import { codedError, type EngineInfo } from '@pixelsky/protocol'
import type { Launcher } from '../adapter'
import { isFile, resolveCommand, run } from '../exec'
import { engineBase } from '../registry'

/** 脚本入口：用当前的 node（Electron 里是 ELECTRON_RUN_AS_NODE 的 Electron 自带 Node）运行 */
const SCRIPT_ENTRY = /\.(?:[cm]?[jt]s)$/i

/** 入口是脚本就用 node 跑，否则当可执行文件直接启动 */
export function pixelLauncher(entry: string): Launcher {
  return SCRIPT_ENTRY.test(extname(entry)) ? { command: process.execPath, args: [entry] } : { command: entry, args: [] }
}

/** 脚本入口由当前进程的 node 跑：带 ELECTRON_RUN_AS_NODE=1（在普通 node 下无影响），Electron 才会当 node 用 */
export function pixelEnvironment(launcher: Launcher, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return launcher.command === process.execPath && launcher.args.length ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env
}

/** 把用户给的路径 / 命令名解析成启动方式；找不到时给出原因 */
function resolveEntry(value: string, env: NodeJS.ProcessEnv): { launcher: Launcher; path: string } | { error: string } {
  const entry = value.trim().replace(/^"(.*)"$/, '$1')
  if (SCRIPT_ENTRY.test(extname(entry))) {
    return isFile(entry)
      ? { launcher: pixelLauncher(entry), path: entry }
      : { error: codedError('launch.notFound', { command: entry }).message }
  }
  const r = resolveCommand(entry, env)
  if (r.ok) return { launcher: pixelLauncher(r.path), path: r.path }
  if (r.reason === 'script') return { error: codedError('launch.script', { path: r.path }).message }
  return { error: codedError(`launch.${r.reason}`, { command: entry }).message }
}

/** 保存前校验用户替换的命令 */
export function customPixel(command: string, env: NodeJS.ProcessEnv): { path: string } | { error: string } {
  const r = resolveEntry(command, env)
  return 'error' in r ? { error: r.error } : { path: r.path }
}

export async function discoverPixel(
  override: string | null,
  env: NodeJS.ProcessEnv,
  bundledCli: string | null,
): Promise<{ info: EngineInfo; launcher: Launcher | null }> {
  const base = { ...engineBase('pixel'), launch: override ? ('custom' as const) : ('stock' as const) }
  const missing = (message: string): { info: EngineInfo; launcher: null } => ({
    info: { ...base, status: 'missing', version: null, path: null, message },
    launcher: null,
  })
  // 用户替换的命令找不到时直接报它，不悄悄换成别的；否则依次试 PIXELSKY_CLI_BIN、自带入口、PATH 上的 pixelsky
  let found: { launcher: Launcher; path: string } | null = null
  if (override) {
    const r = resolveEntry(override, env)
    if ('error' in r) return missing(r.error)
    found = r
  } else {
    for (const candidate of [env.PIXELSKY_CLI_BIN, bundledCli, 'pixelsky']) {
      if (!candidate?.trim()) continue
      const r = resolveEntry(candidate, env)
      if (!('error' in r)) {
        found = r
        break
      }
    }
  }
  if (!found) return missing('Pixel CLI not found. Set PIXELSKY_CLI_BIN or install pixelsky on PATH.')
  const result = await run(found.launcher, ['--version'], pixelEnvironment(found.launcher, env), 12_000)
  const version = result.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null
  return {
    info: {
      ...base,
      status: result.ok && version ? 'ready' : 'error',
      version,
      path: found.path,
      message: result.ok && version ? null : 'Pixel CLI could not start',
    },
    launcher: found.launcher,
  }
}
