import { useSyncExternalStore } from 'react'

// 「发现本机页面」提示条的总开关（docs/ui/port-preview.md §7）：本机所有对话、所有窗口共用，默认开。
// 关掉只是不画提示条，端口照常记录，右侧面板「端口」页不受影响
export const PORT_TIP_OFF_KEY = 'pixelsky.portTip.off'

const listeners = new Set<() => void>()
let fallback = false

export function readPortTipOff(): boolean {
  try {
    if (!window.pixelsky?.demo) return localStorage.getItem(PORT_TIP_OFF_KEY) === '1'
  } catch {
    // 存储不可用时用本窗口内的记录。
  }
  return fallback
}

export function setPortTipOff(off: boolean): void {
  fallback = off
  try {
    if (!window.pixelsky?.demo) {
      if (off) localStorage.setItem(PORT_TIP_OFF_KEY, '1')
      else localStorage.removeItem(PORT_TIP_OFF_KEY)
    }
  } catch {
    // 本次仍然生效。
  }
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  const onStorage = (event: StorageEvent): void => {
    if (event.storageArea === localStorage && (event.key === PORT_TIP_OFF_KEY || event.key === null)) fn()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

export function usePortTipOff(): boolean {
  return useSyncExternalStore(subscribe, readPortTipOff, () => false)
}
