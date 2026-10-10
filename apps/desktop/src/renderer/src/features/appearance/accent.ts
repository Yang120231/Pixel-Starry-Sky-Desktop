// 强调色预设：只换 --accent* 这组界面主色，底色、文字、代码高亮、终端配色不变。颜色定义在 styles/tokens.css。
// 设置写成 <html data-accent>，改完立刻生效；保存在 localStorage，多窗口同步。
import { useSyncExternalStore } from 'react'

export const ACCENTS = ['green', 'blue', 'violet', 'teal', 'amber', 'rose', 'graphite'] as const
export type Accent = (typeof ACCENTS)[number]
export const DEFAULT_ACCENT: Accent = 'green'
export const ACCENT_KEY = 'pixelsky.accent'

export function parseAccent(value: unknown): Accent {
  return ACCENTS.includes(value as Accent) ? (value as Accent) : DEFAULT_ACCENT
}

function read(): Accent {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_ACCENT
    return parseAccent(localStorage.getItem(ACCENT_KEY))
  } catch {
    return DEFAULT_ACCENT
  }
}

function apply(next: Accent): void {
  if (typeof document === 'undefined') return
  // 默认墨绿就是 tokens.css 里的基础值，不写属性
  if (next === DEFAULT_ACCENT) delete document.documentElement.dataset.accent
  else document.documentElement.dataset.accent = next
}

let accent = read()
apply(accent)
const listeners = new Set<() => void>()

export function setAccent(next: Accent): void {
  if (!ACCENTS.includes(next)) return
  const changed = accent !== next
  accent = next
  apply(accent)
  try {
    localStorage.setItem(ACCENT_KEY, accent)
  } catch {
    /* 存储不可用时，本次仍然可切换。 */
  }
  if (changed) listeners.forEach(listener => listener())
}

function onStorage(event: StorageEvent): void {
  if (event.storageArea !== localStorage || (event.key !== ACCENT_KEY && event.key !== null)) return
  const next = read()
  if (next === accent) return
  accent = next
  apply(accent)
  listeners.forEach(listener => listener())
}

// 不在设置页时其他窗口改了也要跟着变，所以一直监听
if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAccent(): Accent {
  return useSyncExternalStore(
    subscribe,
    () => accent,
    () => DEFAULT_ACCENT,
  )
}
