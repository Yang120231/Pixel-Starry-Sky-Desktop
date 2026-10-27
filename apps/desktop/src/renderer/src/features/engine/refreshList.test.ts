// 切换 / 连上机器时重新拉列表：拉的期间推来的会话列表更新，不被拉回来的旧列表盖掉（审计 2026-10-27 #19）
import { describe, expect, it, vi } from 'vitest'
import type { HostEvent, SessionSummary } from '@pixelsky/protocol'

vi.mock('@/data', () => ({ isDemo: false }))
vi.mock('@/data/demo', () => ({ demo: () => ({}) }))
vi.mock('@/features/machines/store', () => ({ getMachines: () => ({ currentId: 'local' }), machineOf: () => 'local' }))

const session = (id: string, state: string): SessionSummary =>
  ({ record: { id, projectId: 'p1' }, state }) as unknown as SessionSummary

let onEvent: (e: HostEvent) => void = () => {}
let releaseEngines: () => void = () => {}
vi.stubGlobal('window', {
  pixelsky: {
    engine: {
      onEvent: (cb: (e: HostEvent) => void) => (onEvent = cb),
      projects: async () => [],
      sessions: async () => [session('s1', 'running')],
      defaults: async () => null,
      // 走 SSH 的那几个慢
      engines: () => new Promise(resolve => (releaseEngines = () => resolve([]))),
      config: async () => null,
    },
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
})

const store = await import('./store')

describe('重新拉列表', () => {
  it('拉的期间推来的会话状态更新：保留推来的', async () => {
    store.startEngineStore()
    await new Promise(r => setTimeout(r, 0))
    onEvent({ kind: 'sessions', sessions: [session('s1', 'running')] } as unknown as HostEvent)
    const refreshing = store.refreshMachineEngine('local')
    await Promise.resolve()
    onEvent({ kind: 'sessions', sessions: [session('s1', 'idle')] } as unknown as HostEvent)
    releaseEngines()
    await refreshing
    expect(store.getEngineState().sessions.map(s => s.state)).toEqual(['idle'])
  })
})
