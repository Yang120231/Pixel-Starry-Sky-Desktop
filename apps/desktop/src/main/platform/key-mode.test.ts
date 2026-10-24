import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// 扣费用的 Key（docs/ui/platform-key-mode.md）：存在 userData，平台请求都带上；不认识的值当作默认的自动。

const scratch = resolve('../../scratch')
mkdirSync(scratch, { recursive: true })
const userData = mkdtempSync(join(scratch, 'key-mode-'))
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  headers: null as null | (() => Record<string, string>),
}))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('../ipc/guard', () => ({
  handle: (name: string, fn: (...args: unknown[]) => unknown) => mocks.handlers.set(name, fn),
}))
vi.mock('../account/account', () => ({
  setPlatformHeaders: (fn: () => Record<string, string>) => (mocks.headers = fn),
}))

const { initKeyMode, keyMode, loadKeyMode, parseKeyMode, KEY_MODE_HEADER } = await import('./key-mode')

afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('扣费用的 Key', () => {
  it('只认 own，其余都是自动；文件坏了或没有也是自动', () => {
    expect([parseKeyMode('own'), parseKeyMode('auto'), parseKeyMode('OWN'), parseKeyMode(null)]).toEqual([
      'own',
      'auto',
      'auto',
      'auto',
    ])
    const file = join(userData, 'bad.json')
    expect(loadKeyMode(file)).toBe('auto')
    writeFileSync(file, '{oops')
    expect(loadKeyMode(file)).toBe('auto')
    writeFileSync(file, JSON.stringify({ mode: 'own' }))
    expect(loadKeyMode(file)).toBe('own')
  })

  it('默认自动；切换后写进文件、请求头跟着变；不认识的值拒绝', () => {
    initKeyMode()
    expect(keyMode()).toBe('auto')
    expect(mocks.headers?.()).toEqual({ [KEY_MODE_HEADER]: 'auto' })
    expect(mocks.handlers.get('platform:keyMode')?.()).toBe('auto')

    expect(mocks.handlers.get('platform:setKeyMode')?.({}, 'own')).toBe('own')
    expect(mocks.headers?.()).toEqual({ [KEY_MODE_HEADER]: 'own' })
    expect(JSON.parse(readFileSync(join(userData, 'platform-key-mode.json'), 'utf8'))).toEqual({ mode: 'own' })

    expect(() => mocks.handlers.get('platform:setKeyMode')?.({}, 'everything')).toThrow()
    expect(keyMode()).toBe('own')
  })
})
