import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostEvent } from '@pixelsky/protocol'

// 流式增量合并通知：状态立刻更新，订阅者每帧最多通知一次
vi.mock('@/data', () => ({ isDemo: false }))
vi.mock('@/data/demo', () => ({ demo: () => ({}) }))
vi.mock('@/features/machines/store', () => ({ getMachines: () => ({ currentId: 'local' }), machineOf: () => 'local' }))

const ID = 's1'
const item = { id: 'a1', kind: 'assistant', text: '', status: 'running' }
const snapshot = { record: { id: ID }, items: [item], state: 'running', pending: [] }

let onEvent: (e: HostEvent) => void = () => {}
let frame: (() => void) | undefined

const ev = (seq: number, event: unknown): HostEvent =>
  ({ kind: 'session', sessionId: ID, seq, event }) as unknown as HostEvent

async function setup() {
  vi.resetModules()
  vi.stubGlobal('window', {
    pixelsky: {
      engine: {
        onEvent: (cb: (e: HostEvent) => void) => (onEvent = cb),
        openSession: async () => ({ snapshot, seq: 0 }),
        projects: async () => [],
        sessions: async () => [],
        defaults: async () => null,
        engines: async () => [],
        config: async () => null,
      },
    },
    dispatchEvent: () => true,
  })
  const store = await import('./store')
  store.startEngineStore()
  await store.openSession(ID)
  const listener = vi.fn()
  return { store, listener }
}

describe('engine store 增量合并通知', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    frame = undefined
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => ((frame = cb), 1))
    vi.stubGlobal('cancelAnimationFrame', () => (frame = undefined))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('状态立刻更新，监听者每帧只通知一次，非增量事件立刻通知', async () => {
    const { store } = await setup()
    const notified = vi.fn()
    const unsub = store.subscribeEngine(notified)
    notified.mockClear()
    for (let i = 1; i <= 100; i++) onEvent(ev(i, { type: 'item_delta', itemId: 'a1', field: 'text', delta: 'x' }))
    const text = () => (store.getEngineState().snapshots[ID].items[0] as { text: string }).text
    expect(text()).toHaveLength(100)
    expect(notified).not.toHaveBeenCalled()
    frame?.()
    expect(notified).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(200)
    expect(notified).toHaveBeenCalledTimes(1)

    onEvent(ev(101, { type: 'item_delta', itemId: 'a1', field: 'text', delta: 'y' }))
    onEvent(ev(102, { type: 'status', state: 'idle' }))
    expect(notified).toHaveBeenCalledTimes(2)
    expect(frame).toBeUndefined()
    unsub()
  })

  it('rAF 不触发时定时器兜底', async () => {
    const { store } = await setup()
    const notified = vi.fn()
    store.subscribeEngine(notified)
    onEvent(ev(1, { type: 'item_delta', itemId: 'a1', field: 'text', delta: 'x' }))
    vi.advanceTimersByTime(100)
    expect(notified).toHaveBeenCalledTimes(1)
    expect(frame).toBeUndefined()
  })
})
