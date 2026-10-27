// 每个会话发现的端口、本会话忽略了哪些、哪些已经在浏览器打开过。「忽略」按会话存进 localStorage，重开软件后只有新端口再提示（docs/ui/port-preview.md §6）
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Item } from '@pixelsky/protocol'
import { machineOf } from '@/features/machines/store'
import { discoverPorts, readIgnored, saveIgnored, type FoundPort, type PortCache } from './portTipsModel'

export interface PortState {
  found: readonly FoundPort[]
  ignored: ReadonlySet<number>
  opened: ReadonlySet<number>
}

const EMPTY: PortState = { found: [], ignored: new Set(), opened: new Set() }
const states = new Map<string, PortState>()
const listeners = new Set<() => void>()

/** 会话第一次用到时读回存着的忽略记录 */
function stateOf(sessionId: string): PortState {
  let state = states.get(sessionId)
  if (!state) {
    state = { ...EMPTY, ignored: new Set(readIgnored(sessionId)) }
    states.set(sessionId, state)
  }
  return state
}

function update(sessionId: string, patch: Partial<PortState>): void {
  states.set(sessionId, { ...stateOf(sessionId), ...patch })
  for (const l of listeners) l()
}

const sameFound = (a: readonly FoundPort[], b: readonly FoundPort[]): boolean =>
  a.length === b.length && a.every((x, i) => x.port === b[i].port)

function publish(sessionId: string, found: readonly FoundPort[]): void {
  if (!sameFound(stateOf(sessionId).found, found)) update(sessionId, { found })
}

export function ignorePorts(sessionId: string, ports: readonly number[]): void {
  const ignored = new Set([...stateOf(sessionId).ignored, ...ports])
  update(sessionId, { ignored })
  saveIgnored(sessionId, [...ignored])
}

export function markOpened(sessionId: string, port: number): void {
  update(sessionId, { opened: new Set([...stateOf(sessionId).opened, port]) })
}

export function usePortState(sessionId: string | null | undefined): PortState {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    () => (sessionId ? stateOf(sessionId) : EMPTY),
  )
}

/** 把会话条目里发现的端口登记进去。远程机器的会话要先走 SSH 端口转发，第一版不提示 */
export function usePublishPorts(sessionId: string | null, items: readonly Item[]): void {
  const cache = useRef<PortCache>(new Map())
  const found = useMemo(
    () => (sessionId && machineOf(sessionId) === 'local' ? discoverPorts(items, cache.current) : []),
    [sessionId, items],
  )
  useEffect(() => {
    if (sessionId) publish(sessionId, found)
  }, [sessionId, found])
}
