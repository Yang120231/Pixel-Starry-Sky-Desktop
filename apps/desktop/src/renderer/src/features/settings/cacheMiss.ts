import { useSyncExternalStore } from 'react'

const KEY = 'pixelsky.cache-miss-alert'
function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false'
  } catch {
    return true
  }
}
let enabled = load()
const listeners = new Set<() => void>()
function emit(): void {
  listeners.forEach(fn => fn())
}
export function setCacheMissAlert(value: boolean): void {
  enabled = value
  try {
    localStorage.setItem(KEY, String(value))
  } catch {
    /* 当前设置仍然生效 */
  }
  emit()
}
function onStorage(event: StorageEvent): void {
  if (event.storageArea === localStorage && (event.key === KEY || event.key === null)) {
    enabled = load()
    emit()
  }
}
function subscribe(fn: () => void): () => void {
  if (!listeners.size) window.addEventListener('storage', onStorage)
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
    if (!listeners.size) window.removeEventListener('storage', onStorage)
  }
}
export function useCacheMissAlert(): boolean {
  return useSyncExternalStore(subscribe, () => enabled)
}
