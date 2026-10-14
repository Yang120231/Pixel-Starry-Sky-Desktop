// 侧栏「这是 WSL 里的项目」说明条：关掉的发行版（机器 id）存在本机 localStorage
import { useSyncExternalStore } from 'react'

const KEY = 'pixelsky.wsl.hint-dismissed'
const listeners = new Set<() => void>()

export function readDismissed(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
export function dismissWslHint(id: string): void {
  const list = readDismissed()
  if (!list.includes(id))
    try {
      localStorage.setItem(KEY, JSON.stringify([...list, id]))
    } catch {}
  listeners.forEach(fn => fn())
}
export function useWslHintDismissed(id: string): boolean {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    () => readDismissed().includes(id),
  )
}
