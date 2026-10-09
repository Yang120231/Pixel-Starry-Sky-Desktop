import { homedir } from 'node:os'
import { dirname, join, delimiter } from 'node:path'
import type { EngineInfo } from '@pixelsky/protocol'
import type { Launcher } from '../adapter'
import { isFile, run } from '../exec'
import { ENGINES } from '../registry'

/** npm shim 只用于找安装目录；协议子进程直接启动原生二进制。 */
export function codexExecutable(path: string): string | null {
  if (isFile(path) && (!/\.(?:cmd|ps1|js)$/i.test(path))) return path
  const bases = [dirname(path), join(dirname(path), '..'), path]
  const triplet = process.platform === 'win32' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc` : process.platform === 'darwin' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin` : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`
  const platform = `${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`
  for (const base of bases) for (const root of [base, join(base, 'node_modules/@openai/codex'), join(base, '@openai/codex')]) {
    for (const vendor of [join(root, 'node_modules/@openai', `codex-${platform}`, 'vendor'), join(root, 'vendor'), join(root, '..', `codex-${platform}`, 'vendor')]) {
      const exe = join(vendor, triplet, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex')
      if (isFile(exe)) return exe
    }
  }
  return null
}
export function toolEnvironment(launcher: Launcher, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const bin = dirname(launcher.command), key = Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH'
  return { ...env, [key]: [bin, join(bin, '../path'), env[key]].filter(Boolean).join(delimiter) }
}
export async function discoverCodex(override: string | null, env: NodeJS.ProcessEnv): Promise<{ info: EngineInfo; launcher: Launcher | null }> {
  const candidates = override ? [override] : [env.PIXELSKY_CODEX_BIN, ...(env.PATH ?? env.Path ?? '').split(delimiter).flatMap(dir => ['codex.exe', 'codex.cmd', 'codex'].map(name => join(dir.replace(/^"|"$/g, ''), name))), join(homedir(), '.local/bin/codex.exe'), join(env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'npm/codex.cmd')].filter((v): v is string => !!v)
  const path = candidates.map(codexExecutable).find(Boolean)
  const base = ENGINES.codex
  if (!path) return { info: { ...base, status: 'missing', version: null, path: null, message: 'Codex executable not found. Install Codex CLI or choose its path.' }, launcher: null }
  const launcher = { command: path, args: [] }, result = await run(launcher, ['--version'], toolEnvironment(launcher, env), 12_000)
  const version = result.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null
  return { info: { ...base, status: result.ok ? 'ready' : 'error', version, path, message: result.ok ? null : 'Codex executable could not start' }, launcher }
}
