import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { TerminalProfile, TerminalProfileInput } from '../../preload/terminal'
export function executable(value: string): string | null {
  if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value)) return null
  try {
    const candidates = isAbsolute(value) ? [value] : execFileSync('where.exe', [value], { encoding: 'utf8', timeout: 2000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)
    for (const path of candidates) {
      // A Store execution alias may be first on PATH but inaccessible to stat.
      try { if (path && statSync(path).isFile()) return path } catch { /* Try the next real executable. */ }
    }
    return null
  } catch { return null }
}

/** Read installed locations without depending on the desktop process inheriting pwsh's PATH. */
export function powerShell7(): string | null {
  const fromPath = executable('pwsh.exe')
  if (fromPath) return fromPath
  const folders = new Set([process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files'].filter((v): v is string => !!v))
  const candidates = [...folders].map(folder => join(folder, 'PowerShell', '7', 'pwsh.exe'))
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'PowerShell', '7', 'pwsh.exe'))
  for (const path of candidates) { const found = executable(path); if (found) return found }
  const windowsShell = executable(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  if (!windowsShell) return null
  // Use an absolute Windows PowerShell path and a fixed, profile-free read script.
  // UTF-8 output preserves non-ASCII usernames and custom installation directories.
  const script = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'SilentlyContinue'
$paths = @(
  foreach ($hive in @('HKCU:', 'HKLM:')) {
    $key = Get-Item -LiteralPath ($hive + '\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\pwsh.exe')
    if ($key) { $key.GetValue('') }
    Get-ChildItem -Path ($hive + '\\SOFTWARE\\Microsoft\\PowerShellCore\\InstalledVersions') | ForEach-Object {
      $version = Get-ItemProperty -LiteralPath $_.PSPath
      if ($version.SemanticVersion -match '^7\\.\\d+\\.\\d+$' -and $version.InstallLocation) { Join-Path $version.InstallLocation 'pwsh.exe' }
    }
  }
)
$valid = @($paths | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($valid.Count -eq 0) {
  $valid = @(Get-AppxPackage -Name Microsoft.PowerShell | Sort-Object { [version]$_.Version } -Descending | ForEach-Object { Join-Path $_.InstallLocation 'pwsh.exe' })
}
ConvertTo-Json -InputObject @($valid) -Compress
`
  try {
    const output = execFileSync(windowsShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    })
    const paths: unknown = JSON.parse(output.replace(/^\uFEFF/, '').trim())
    if (Array.isArray(paths)) for (const path of paths) {
      if (typeof path !== 'string' || !isAbsolute(path)) continue
      const found = executable(path)
      if (found) return found
    }
  } catch { /* Missing installation or metadata cannot make a profile available. */ }
  return null
}
export function detectProfiles(custom: TerminalProfile[] = []): TerminalProfile[] {
  const root = process.env.SystemRoot ?? 'C:\\Windows'
  const git = [join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'), join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe')].find(path => executable(path))
  const known = [
    { id: 'pwsh', label: 'PowerShell 7', command: powerShell7() ?? 'pwsh.exe', args: ['-NoLogo'] },
    { id: 'powershell', label: 'Windows PowerShell', command: join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo'] },
    { id: 'cmd', label: 'cmd', command: process.env.ComSpec ?? 'cmd.exe', args: ['/d'] },
    ...(git ? [{ id: 'git-bash', label: 'Git Bash', command: git, args: ['--login', '-i'] }] : []),
  ]
  return [...known, ...custom].map(profile => { const command = executable(profile.command); return { ...profile, command: command ?? profile.command, available: !!command } })
}
export function terminalTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 120 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('终端名称需为 1–120 个字符，不能包含换行')
  return value.trim()
}
export function profileInput(value: TerminalProfileInput): TerminalProfileInput {
  if (!value || typeof value !== 'object' || typeof value.command !== 'string' || !value.command.trim() || value.command.length > 4096 || /[\r\n\0]/.test(value.command)) throw new Error('Shell 程序路径不正确')
  if (!Array.isArray(value.args) || value.args.length > 64 || value.args.some(v => typeof v !== 'string' || v.length > 8192 || v.includes('\0'))) throw new Error('Shell 参数必须是字符串数组')
  if (value.id !== undefined && (typeof value.id !== 'string' || !value.id.startsWith('custom-'))) throw new Error('只能修改自定义 Shell')
  return { id: value.id, label: terminalTitle(value.label), command: value.command.trim(), args: [...value.args] }
}
export function terminalEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string' || /^(ELECTRON_|PIXELSKY_|NODE_OPTIONS$|NODE_PATH$|VSCODE_INSPECTOR_OPTIONS$|CLAUDECODE$|CLAUDE_CODE_ENTRYPOINT$)/i.test(key)) continue
    env[key] = value
  }
  env.TERM = 'xterm-256color'
  return env
}
