import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const disk = vi.hoisted(() => ({ files: new Set<string>(), path: [] as string[], installed: '[]', calls: [] as string[][] }))
vi.mock('node:fs', () => ({ statSync: (path: string) => {
  if (!disk.files.has(path)) throw Object.assign(new Error('Cannot stat'), { code: 'EACCES' })
  return { isFile: () => true }
} }))
vi.mock('node:child_process', () => ({ execFileSync: (command: string, args: string[]) => {
  disk.calls.push([command, ...args])
  if (command === 'where.exe') {
    if (!disk.path.length) throw new Error('not on PATH')
    return disk.path.join('\r\n')
  }
  return disk.installed
} }))
import { detectProfiles, executable, powerShell7 } from './profiles'

beforeEach(() => {
  disk.files.clear(); disk.path = []; disk.installed = '[]'; disk.calls = []
  vi.stubEnv('SystemRoot', 'C:\\Windows')
  vi.stubEnv('ProgramFiles', 'C:\\Program Files')
  vi.stubEnv('ProgramW6432', 'C:\\Program Files')
  vi.stubEnv('ProgramFiles(x86)', 'C:\\Program Files (x86)')
  vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\tester\\AppData\\Local')
})
const nativeShell = join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
afterEach(() => vi.unstubAllEnvs())

describe('PowerShell installation discovery', () => {
  it('skips an inaccessible WindowsApps alias ahead of a usable executable', () => {
    const real = join('D:\\tools', 'pwsh.exe')
    disk.path = ['C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe', real]
    disk.files.add(real)
    expect(executable('pwsh.exe')).toBe(real)
    expect(powerShell7()).toBe(real)
    expect(disk.calls.every(call => call[0] === 'where.exe')).toBe(true)
  })
  it('finds the standard installation when Explorer inherited an old PATH', () => {
    const real = join('C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')
    disk.files.add(real)
    expect(powerShell7()).toBe(real)
  })
  it('resolves Store or registered custom locations, including Unicode, to the real exe', () => {
    const real = join('D:\\应用程序', 'PowerShell', 'pwsh.exe')
    disk.files.add(nativeShell); disk.files.add(real)
    disk.installed = JSON.stringify([real])
    expect(detectProfiles().find(p => p.id === 'pwsh')).toMatchObject({ available: true, command: real })
    const probe = disk.calls.find(call => call[0] === nativeShell)!
    expect(probe).toContain('-NoProfile')
    expect(probe).toContain('-NonInteractive')
  })
  it('does not enable a missing installation just because metadata lists it', () => {
    disk.files.add(nativeShell)
    disk.installed = JSON.stringify(['C:\\deleted\\pwsh.exe', 'relative.exe'])
    expect(detectProfiles().find(p => p.id === 'pwsh')?.available).toBe(false)
  })
  it('keeps Windows PowerShell available when PowerShell 7 metadata cannot be read', () => {
    disk.files.add(nativeShell); disk.installed = 'invalid output'
    const profiles = detectProfiles()
    expect(profiles.find(p => p.id === 'pwsh')?.available).toBe(false)
    expect(profiles.find(p => p.id === 'powershell')).toMatchObject({ available: true, command: nativeShell })
  })
})
