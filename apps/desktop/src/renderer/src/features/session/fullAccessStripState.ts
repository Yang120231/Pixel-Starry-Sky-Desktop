import { useSyncExternalStore } from 'react'
import type { PermissionMode } from '@pixelsky/protocol'

export const FULL_ACCESS_STRIP_DISMISSED_KEY = 'pixelsky.fullAccess.stripDismissed'
const listeners = new Set<() => void>()
let fallback = false

/** 本机所有窗口共用一次风险提示的确认；切换对话、重新挂载不清除。 */
export function readFullAccessStripDismissed(): boolean {
  try {
    if (!window.pixelsky?.demo) return localStorage.getItem(FULL_ACCESS_STRIP_DISMISSED_KEY) === '1'
  } catch {
    // 存储不可用时保留本窗口内的确认。
  }
  return fallback
}

function setDismissed(next: boolean): void {
  fallback = next
  try {
    if (!window.pixelsky?.demo) {
      if (next) localStorage.setItem(FULL_ACCESS_STRIP_DISMISSED_KEY, '1')
      else localStorage.removeItem(FULL_ACCESS_STRIP_DISMISSED_KEY)
    }
  } catch {
    // 本次仍然生效。
  }
  listeners.forEach(fn => fn())
}

export function dismissFullAccessStrip(): void {
  setDismissed(true)
}

/** 任一窗口选择非完全放行模式就清除全局确认；重新切入完全放行时也恢复提示。 */
export function resetFullAccessStripOnModeChange(from: PermissionMode, to: PermissionMode): void {
  if (to !== 'full' || from !== 'full') setDismissed(false)
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  const onStorage = (event: StorageEvent): void => {
    if (event.storageArea === localStorage && (event.key === FULL_ACCESS_STRIP_DISMISSED_KEY || event.key === null))
      fn()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

export function useFullAccessStripDismissed(): boolean {
  return useSyncExternalStore(subscribe, readFullAccessStripDismissed, () => false)
}
