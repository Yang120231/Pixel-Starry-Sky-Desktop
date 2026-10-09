import { useSyncExternalStore } from 'react'

export type ComposerStyle = 'chatgpt' | 'claude'
export const COMPOSER_STYLE_KEY = 'pixelsky.composer-style'
export const DEFAULT_COMPOSER_STYLE: ComposerStyle = 'claude'

function read(): ComposerStyle {
  try { const value = localStorage.getItem(COMPOSER_STYLE_KEY); return value === 'chatgpt' || value === 'claude' ? value : DEFAULT_COMPOSER_STYLE }
  catch { return DEFAULT_COMPOSER_STYLE }
}
let style = read()
const listeners = new Set<() => void>()
export function setComposerStyle(next: ComposerStyle): void {
  if (next !== 'chatgpt' && next !== 'claude') return
  const changed = style !== next
  style = next
  try { localStorage.setItem(COMPOSER_STYLE_KEY, style) } catch { /* 存储不可用时，本次仍然可切换。 */ }
  if (changed) listeners.forEach(listener => listener())
}
function onStorage(event: StorageEvent): void {
  if (event.storageArea !== localStorage || (event.key !== COMPOSER_STYLE_KEY && event.key !== null)) return
  const next = read()
  if (next === style) return
  style = next
  listeners.forEach(listener => listener())
}
function subscribe(listener: () => void): () => void {
  if (!listeners.size) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('storage', onStorage) }
}
export function useComposerStyle(): ComposerStyle { return useSyncExternalStore(subscribe, () => style, () => DEFAULT_COMPOSER_STYLE) }
