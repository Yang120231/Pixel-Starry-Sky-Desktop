import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostEvent } from '@pixelsky/protocol'

// 快照的引用计数与释放（docs/ui/renderer-memory.md §3.4）
vi.mock('@/data', () => ({ isDemo: false }))
vi.mock('@/data/demo', () => ({ demo: () => ({}) }))
vi.mock('@/features/machines/store', () => ({ getMachines: () => ({ currentId: 'local' }), machineOf: () => 'local' }))

const IDS = ['a', 'b', 'c', 'd', 'e']
const summary = (id: string, over: Record<string, unknown> = {}) => ({
  record: { id, title: id, projectId: 'p', updatedAt: 0, archivedAt: undefined },
  state: 'idle',
  ...over,
})
const snapshotOf = (id: string, over: Record<string, unknown> = {}) => ({
  record: { id },
  items: [],
  state: 'idle',
  pending: [],
  ...over,
})

let onEvent: (e: HostEvent) => void = () => {}
let seqOf: Record<string, number> = {}

async function setup(demoBridge = true) {
  vi.resetModules()
  vi.stubGlobal('window', {
    pixelsky: demoBridge
      ? {
          engine: {
            onEvent: (cb: (e: HostEvent) => void) => (onEvent = cb),
            openSession: async (id: string) => ({ snapshot: snapshotOf(id), seq: seqOf[id] ?? 0 }),
            projects: async () => [],
            sessions: async () => IDS.map(id => summary(id)),
            defaults: async () => null,
            engines: async () => [],
            config: async () => null,
          },
        }
      : undefined,
    dispatchEvent: () => true,
  })
  const store = await import('./store')
  store.startEngineStore()
  await vi.advanceTimersByTimeAsync(0)
  return store
}

const keys = (store: { getEngineState: () => { snapshots: object } }) => Object.keys(store.getEngineState().snapshots)
const ev = (id: string, seq: number, event: unknown): HostEvent =>
  ({ kind: 'session', sessionId: id, seq, event }) as unknown as HostEvent
const listEvent = (sessions: unknown[]): HostEvent => ({ kind: 'sessions', sessions }) as unknown as HostEvent

/** 依次打开再关掉（引用归零）每个会话 */
async function openAndRelease(store: Awaited<ReturnType<typeof setup>>, ids: string[]) {
  for (const id of ids) {
    store.retainSession(id)
    await store.openSession(id)
    store.releaseSession(id)
  }
}

describe('engine store 快照释放', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    seqOf = {}
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('引用归零后延后 3 秒清理，只留最近 3 个', async () => {
    const store = await setup()
    await openAndRelease(store, IDS)
    expect(keys(store)).toHaveLength(5)
    vi.advanceTimersByTime(2999)
    expect(keys(store)).toHaveLength(5)
    vi.advanceTimersByTime(1)
    expect(keys(store).sort()).toEqual(['c', 'd', 'e'])
  })

  it('引用回到 1 的不删（StrictMode 的 retain → release → retain）', async () => {
    const store = await setup()
    await openAndRelease(store, IDS)
    store.retainSession('a')
    vi.advanceTimersByTime(3000)
    expect(keys(store).sort()).toEqual(['a', 'c', 'd', 'e'].sort())
  })

  it('运行中和等你处理的不释放也不占名额', async () => {
    const store = await setup()
    store.retainSession('a')
    await store.openSession('a')
    onEvent(ev('a', 1, { type: 'status', state: 'running' }))
    store.releaseSession('a')
    await openAndRelease(store, ['b', 'c', 'd', 'e'])
    vi.advanceTimersByTime(3000)
    expect(keys(store).sort()).toEqual(['a', 'c', 'd', 'e'])
  })

  it('归档且没人用的直接删，不等延时', async () => {
    const store = await setup()
    await openAndRelease(store, ['a', 'b'])
    onEvent(
      listEvent(IDS.map(id => summary(id, id === 'a' ? { record: { ...summary(id).record, archivedAt: 1 } } : {}))),
    )
    expect(keys(store)).toEqual(['b'])
  })

  it('释放后事件不会重建快照，再打开序号衔接', async () => {
    const store = await setup()
    await openAndRelease(store, IDS)
    vi.advanceTimersByTime(3000)
    onEvent(ev('a', 1, { type: 'status', state: 'running' }))
    expect(store.getEngineState().snapshots.a).toBeUndefined()
    seqOf.a = 5
    await store.openSession('a')
    onEvent(ev('a', 5, { type: 'status', state: 'running' }))
    expect(store.getEngineState().snapshots.a.state).toBe('idle')
    onEvent(ev('a', 6, { type: 'status', state: 'running' }))
    expect(store.getEngineState().snapshots.a.state).toBe('running')
  })

  it('没有快照但打开过的会话，跑完照样标有新回复', async () => {
    const store = await setup()
    await openAndRelease(store, IDS)
    vi.advanceTimersByTime(3000)
    onEvent(ev('a', 1, { type: 'turn_completed' }))
    expect(store.getEngineState().unread.a).toBe(true)
  })

  it('标签里报过的会话也标；两者都不是的不标；正在看的不标', async () => {
    const store = await setup()
    store.noteTabSessions(['b'])
    onEvent(ev('b', 1, { type: 'turn_completed' }))
    onEvent(ev('c', 1, { type: 'turn_completed' }))
    expect(store.getEngineState().unread).toEqual({ b: true })
    store.noteTabSessions(['d'])
    store.setViewingSet(['d'])
    onEvent(ev('d', 1, { type: 'turn_completed' }))
    expect(store.getEngineState().unread.d).toBeUndefined()
  })

  it('会话删除时清掉引用和记录', async () => {
    const store = await setup()
    await openAndRelease(store, ['a'])
    onEvent(listEvent(IDS.filter(id => id !== 'a').map(id => summary(id))))
    expect(keys(store)).toEqual([])
    onEvent(ev('a', 1, { type: 'turn_completed' }))
    expect(store.getEngineState().unread.a).toBeUndefined()
  })

  it('会话从列表消失但组件还挂着：引用保留，组件卸载时不进释放队列', async () => {
    const store = await setup()
    store.retainSession('a')
    await store.openSession('a')
    onEvent(listEvent(IDS.filter(id => id !== 'a').map(id => summary(id))))
    // 列表里又出现（例如重连），组件还挂着：重新拉到快照后清理不能把它释放
    onEvent(listEvent(IDS.map(id => summary(id))))
    await store.openSession('a')
    vi.advanceTimersByTime(10_000)
    store.getEngineState()
    expect(keys(store)).toContain('a')
    store.releaseSession('a')
    vi.advanceTimersByTime(3000)
    expect(keys(store)).toContain('a')
  })

  it('演示模式（没有 bridge）不释放', async () => {
    const store = await setup(false)
    store.retainSession('a')
    store.releaseSession('a')
    vi.advanceTimersByTime(5000)
    expect(keys(store)).toEqual([])
  })
})

describe('startEngineStore 启动顺序', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('先订阅事件，再向主进程报到，最后才拉列表', async () => {
    vi.resetModules()
    const calls: string[] = []
    const call = (name: string, value: unknown) => async () => (calls.push(name), value)
    vi.stubGlobal('window', {
      pixelsky: {
        app: { ready: call('ready', undefined) },
        engine: {
          onEvent: () => void calls.push('subscribe'),
          projects: call('projects', []),
          sessions: call('sessions', []),
          defaults: call('defaults', null),
          engines: call('engines', []),
          config: call('config', null),
        },
      },
      dispatchEvent: () => true,
    })
    const store = await import('./store')
    store.startEngineStore()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.slice(0, 3)).toEqual(['subscribe', 'ready', 'projects'])
  })

  it('没有 bridge（演示模式）只报到，不拉列表', async () => {
    vi.resetModules()
    const ready = vi.fn(async () => undefined)
    vi.stubGlobal('window', { pixelsky: { app: { ready } }, dispatchEvent: () => true })
    const store = await import('./store')
    store.startEngineStore()
    await vi.advanceTimersByTimeAsync(0)
    expect(ready).toHaveBeenCalledTimes(1)
  })
})
