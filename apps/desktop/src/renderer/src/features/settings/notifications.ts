// 设置 › 通知 的本机偏好（docs/ui/notifications.md §2），多个窗口经 storage 事件同步
import { useSyncExternalStore } from 'react'
import { sanitizeNotificationPrefs, type NotificationPrefs } from '../notifications/policy'

const KEY = 'pixelsky.notifications.v1'
function load(): NotificationPrefs {
  try {
    return sanitizeNotificationPrefs(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return sanitizeNotificationPrefs(null)
  }
}
let prefs = load()
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach(fn => fn())

export const getNotificationPrefs = (): NotificationPrefs => prefs

export function setNotificationPrefs(patch: Partial<NotificationPrefs>): void {
  prefs = sanitizeNotificationPrefs({ ...prefs, ...patch, schedule: { ...prefs.schedule, ...patch.schedule } })
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* 当前设置仍然生效 */
  }
  emit()
}

function onStorage(event: StorageEvent): void {
  if (event.storageArea === localStorage && (event.key === KEY || event.key === null)) {
    prefs = load()
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
export function useNotificationPrefs(): NotificationPrefs {
  return useSyncExternalStore(subscribe, getNotificationPrefs)
}
