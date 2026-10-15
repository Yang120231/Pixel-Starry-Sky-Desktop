import { useSyncExternalStore } from 'react'

// 完全放行时输入框上方提示条的「不再提示」：本机所有对话、所有窗口共用，记住 30 天（和 Codex 的
// full-access-warning-dismissed-at 一样）；切换权限不清除。切到完全放行前的确认不受它影响，始终会出现。
export const FULL_ACCESS_STRIP_DISMISSED_KEY = 'pixelsky.fullAccess.stripDismissedAt'
/** 旧版只记「关过」，切换权限就清除；新规则下作废 */
const LEGACY_KEY = 'pixelsky.fullAccess.stripDismissed'
export const FULL_ACCESS_STRIP_DISMISS_MS = 30 * 24 * 60 * 60 * 1000

const listeners = new Set<() => void>()
let fallback: number | null = null

function readAt(): number | null {
  try {
    if (!window.pixelsky?.demo) {
      const at = Number(localStorage.getItem(FULL_ACCESS_STRIP_DISMISSED_KEY))
      return Number.isFinite(at) && at > 0 ? at : null
    }
  } catch {
    // 存储不可用时用本窗口内的记录。
  }
  return fallback
}

export function readFullAccessStripDismissed(now = Date.now()): boolean {
  const at = readAt()
  return at !== null && now - at < FULL_ACCESS_STRIP_DISMISS_MS
}

/** true：从现在起 30 天内不显示；false：恢复显示 */
export function setFullAccessStripDismissed(next: boolean, now = Date.now()): void {
  fallback = next ? now : null
  try {
    if (!window.pixelsky?.demo) {
      if (next) localStorage.setItem(FULL_ACCESS_STRIP_DISMISSED_KEY, String(now))
      else localStorage.removeItem(FULL_ACCESS_STRIP_DISMISSED_KEY)
      localStorage.removeItem(LEGACY_KEY)
    }
  } catch {
    // 本次仍然生效。
  }
  listeners.forEach(fn => fn())
}

export function dismissFullAccessStrip(): void {
  setFullAccessStripDismissed(true)
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

/** 每次渲染都重新读，过了 30 天下一次渲染就恢复显示 */
export function useFullAccessStripDismissed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readFullAccessStripDismissed(),
    () => false,
  )
}
