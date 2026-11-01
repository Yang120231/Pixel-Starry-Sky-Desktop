import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Store = typeof import('./portTipSwitch')
let data: Map<string, string>

async function load(): Promise<Store> {
  vi.resetModules()
  return import('./portTipSwitch')
}

beforeEach(() => {
  data = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  })
  vi.stubGlobal('window', new EventTarget())
})

afterEach(() => vi.unstubAllGlobals())

describe('「发现本机页面」总开关', () => {
  it('默认开；关掉后重开软件仍是关的，打开回来不留记录', async () => {
    const first = await load()
    expect(first.readPortTipOff()).toBe(false)
    first.setPortTipOff(true)
    expect((await load()).readPortTipOff()).toBe(true)
    first.setPortTipOff(false)
    expect((await load()).readPortTipOff()).toBe(false)
    expect(data.has(first.PORT_TIP_OFF_KEY)).toBe(false)
  })
})
