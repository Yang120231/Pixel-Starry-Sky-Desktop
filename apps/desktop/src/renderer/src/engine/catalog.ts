import { useEffect, useSyncExternalStore } from 'react'
import type { EngineCatalog, EngineId } from '@pixelsky/protocol'
import { bridge } from './store'
import { useEngineState } from './store'
import { getMachines, useMachines } from '@/machines/store'

const catalogs: Record<string, EngineCatalog> = {}
const pending = new Set<string>(), listeners = new Set<() => void>()
export function useEngineCatalog(engine: EngineId): EngineCatalog | null {
  const { currentId } = useMachines(), key = currentId + ':' + engine
  const info = useEngineState(state => state.engines.find(value => value.id === engine))
  useEffect(() => {
    if (!bridge || pending.has(key)) return
    pending.add(key)
    void bridge.catalog(engine).then(value => { if (getMachines().currentId === currentId) catalogs[key] = value; listeners.forEach(fn => fn()) }).catch(() => {}).finally(() => pending.delete(key))
  }, [engine, info, key])
  return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn) } }, () => catalogs[key] ?? null)
}
