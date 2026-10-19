// 输入框里的账号额度按钮的显示偏好（docs/ui/account-quota.md §6.8）；所有对话共用，刷新 / 重启后沿用本机选择。
import { useSyncExternalStore } from 'react'

/** 一直显示 / 快用完（任一项到 80%）时才显示 */
export type QuotaShowWhen = 'always' | 'near-limit'
/** 图标和百分比 / 只有图标 */
export type QuotaButtonStyle = 'full' | 'icon'
export interface QuotaDisplay {
  enabled: boolean
  when: QuotaShowWhen
  style: QuotaButtonStyle
}

export const QUOTA_DISPLAY_KEY = 'pixelsky.quota-display'
export const DEFAULT_QUOTA_DISPLAY: QuotaDisplay = { enabled: true, when: 'always', style: 'full' }

/** 存的是 JSON；读到不合法的值逐项回到默认 */
export function parseQuotaDisplay(raw: string | null): QuotaDisplay {
  let value: unknown = null
  try {
    value = raw === null ? null : JSON.parse(raw)
  } catch {
    /* 坏 JSON：全部用默认 */
  }
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_QUOTA_DISPLAY.enabled,
    when: o.when === 'always' || o.when === 'near-limit' ? o.when : DEFAULT_QUOTA_DISPLAY.when,
    style: o.style === 'full' || o.style === 'icon' ? o.style : DEFAULT_QUOTA_DISPLAY.style,
  }
}

function read(): QuotaDisplay {
  try {
    return parseQuotaDisplay(localStorage.getItem(QUOTA_DISPLAY_KEY))
  } catch {
    return DEFAULT_QUOTA_DISPLAY
  }
}

const same = (a: QuotaDisplay, b: QuotaDisplay): boolean =>
  a.enabled === b.enabled && a.when === b.when && a.style === b.style

let display = read()
const listeners = new Set<() => void>()

export function getQuotaDisplay(): QuotaDisplay {
  return display
}

export function setQuotaDisplay(patch: Partial<QuotaDisplay>): void {
  const next = parseQuotaDisplay(JSON.stringify({ ...display, ...patch }))
  if (same(next, display)) return
  display = next
  try {
    localStorage.setItem(QUOTA_DISPLAY_KEY, JSON.stringify(display))
  } catch {
    /* 存储不可用时，本次仍然可切换。 */
  }
  listeners.forEach(listener => listener())
}

function onStorage(event: StorageEvent): void {
  if (event.storageArea !== localStorage || (event.key !== QUOTA_DISPLAY_KEY && event.key !== null)) return
  const next = read()
  if (same(next, display)) return
  display = next
  listeners.forEach(listener => listener())
}

/** 订阅变化；第一个监听者出现时才挂 storage 事件（其它窗口 / 云同步写回时重新读） */
export function subscribeQuotaDisplay(listener: () => void): () => void {
  if (!listeners.size) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener('storage', onStorage)
  }
}

export function useQuotaDisplay(): QuotaDisplay {
  return useSyncExternalStore(
    subscribeQuotaDisplay,
    () => display,
    () => DEFAULT_QUOTA_DISPLAY,
  )
}
