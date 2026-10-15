import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadOnigBytes } from './onig'

const bytes = new Uint8Array([1, 2, 3])

describe('loadOnigBytes', () => {
  it('fetch 成功就不碰 IPC', async () => {
    const fallback = vi.fn()
    const res = { ok: true, arrayBuffer: async () => bytes.buffer } as unknown as Response
    expect(await loadOnigBytes('u', async () => res, fallback)).toBe(bytes.buffer)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('fetch 抛错或响应不 ok 都退到 IPC', async () => {
    const fallback = vi.fn(async () => bytes)
    expect(await loadOnigBytes('u', () => Promise.reject(new Error('x')), fallback)).toBe(bytes)
    const bad = { ok: false, status: 404 } as unknown as Response
    expect(await loadOnigBytes('u', async () => bad, fallback)).toBe(bytes)
    expect(fallback).toHaveBeenCalledTimes(2)
  })

  it('两条路都失败时抛出', async () => {
    await expect(
      loadOnigBytes(
        'u',
        () => Promise.reject(new Error('a')),
        () => Promise.reject(new Error('b')),
      ),
    ).rejects.toThrow('b')
  })
})

describe('onigLib 缓存', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('最终失败的结果在本次会话里缓存', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('no'))),
    )
    const bridge = vi.fn(() => Promise.reject(new Error('ipc down')))
    vi.stubGlobal('window', { pixelsky: { extpacks: { onigWasm: bridge } } })
    const mod = await import('./onig')
    await expect(mod.onigLib()).rejects.toThrow('ipc down')
    await expect(mod.onigLib()).rejects.toThrow('ipc down')
    expect(bridge).toHaveBeenCalledTimes(1)
  })

  it('fetch 失败时用 IPC 的字节建库', async () => {
    const { readFileSync } = await import('node:fs')
    const { createRequire } = await import('node:module')
    const wasm = readFileSync(createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm'))
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('no'))),
    )
    const bridge = vi.fn(async () => new Uint8Array(wasm))
    vi.stubGlobal('window', { pixelsky: { extpacks: { onigWasm: bridge } } })
    const mod = await import('./onig')
    const lib = await mod.onigLib()
    expect(bridge).toHaveBeenCalledTimes(1)
    expect(lib.createOnigScanner(['a']).findNextMatchSync(lib.createOnigString('xa'), 0, 0)).not.toBeNull()
  })
})
