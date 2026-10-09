import { describe, expect, it } from 'vitest'
import { detectPackageManager, scriptCommand } from '../src/package-manager'

describe('project script package manager', () => {
  const none = () => false
  it('prefers the packageManager field, then lockfiles, then npm', () => {
    expect(detectPackageManager('pnpm@9.12.0', none)).toBe('pnpm')
    expect(detectPackageManager('yarn@4.1.0+sha', name => name === 'package-lock.json')).toBe('yarn')
    expect(detectPackageManager(undefined, name => name === 'pnpm-lock.yaml')).toBe('pnpm')
    expect(detectPackageManager(undefined, name => name === 'bun.lockb')).toBe('bun')
    expect(detectPackageManager('weird', none)).toBe('npm')
    expect(detectPackageManager(42, name => name === 'yarn.lock')).toBe('yarn')
  })
  it('builds the run command', () => {
    expect(scriptCommand('pnpm', 'dev:demo')).toBe('pnpm run dev:demo')
  })
})
