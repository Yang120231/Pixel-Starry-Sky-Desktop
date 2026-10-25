// 每个会话发现的端口、本会话忽略了哪些、哪些已经在浏览器打开过。只放内存：「忽略」不跨会话、不跨重启（docs/ui/port-preview.md）
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Item } from '@pixelsky/protocol'
import { machineOf } from '@/features/machines/store'
import { discoverPorts, type FoundPort, type PortCache } from './portTipsModel'

export interface PortState {
  found: readonly FoundPort[]
  ignored: ReadonlySet<number>
  opened: ReadonlySet<number>
}

const EMPTY: PortState = { found: [], ignored: new Set(), opened: new Set() }
const states = new Map<string, PortState>()
const listeners = new Set<() => void>()

function update(sessionId: string, patch: Partial<PortState>): void {
  states.set(sessionId, { ...(states.get(sessionId) ?? EMPTY), ...patch })
  for (const l of listeners) l()
}

const sameFound = (a: readonly FoundPort[], b: readonly FoundPort[]): boolean =>
  a.length === b.length && a.every((x, i) => x.port === b[i].port)

function publish(sessionId: string, found: readonly FoundPort[]): void {
  if (!sameFound((states.get(sessionId) ?? EMPTY).found, found)) update(sessionId, { found })
}

export function ignorePorts(sessionId: string, ports: readonly number[]): void {
  update(sessionId, { ignored: new Set([...(states.get(sessionId) ?? EMPTY).ignored, ...ports]) })
}

export function markOpened(sessionId: string, port: number): void {
  update(sessionId, { opened: new Set([...(states.get(sessionId) ?? EMPTY).opened, port]) })
}

export function usePortState(sessionId: string | null | undefined): PortState {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    () => (sessionId ? (states.get(sessionId) ?? EMPTY) : EMPTY),
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
