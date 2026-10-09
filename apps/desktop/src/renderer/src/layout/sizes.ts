import { useSyncExternalStore } from 'react'

export const DEFAULT_SIDEBAR_WIDTH = 290
export const DEFAULT_COMPOSER_WIDTH = 960
const KEY = 'pixelsky.layout-sizes.v1'
interface LayoutSizes {
  rightWorkspace: number
  sidebar: number
  composer: number
  /** null 使用原有的随内容增高模式；数值是文本输入区高度。 */
  composerHeight: number | null
}
function validSize(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}
function read(): LayoutSizes {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      rightWorkspace: validSize(p.rightWorkspace, 360, 2000, 720),
      sidebar: validSize(p.sidebar, 240, 480, DEFAULT_SIDEBAR_WIDTH),
      composer: validSize(p.composer, 320, 2400, DEFAULT_COMPOSER_WIDTH),
      composerHeight: typeof p.composerHeight === 'number' ? validSize(p.composerHeight, 56, 1200, 56) : null,
    }
  } catch { return { rightWorkspace: 720, sidebar: DEFAULT_SIDEBAR_WIDTH, composer: DEFAULT_COMPOSER_WIDTH, composerHeight: null } }
}
let sizes = read()
const listeners = new Set<() => void>()
export function setLayoutSize<K extends keyof LayoutSizes>(key: K, value: LayoutSizes[K], persist = false): void {
  const changed = sizes[key] !== value
  if (changed) sizes = { ...sizes, [key]: value }
  if (persist) try { localStorage.setItem(KEY, JSON.stringify(sizes)) } catch { /* 本次使用仍然有效 */ }
  if (changed) listeners.forEach(fn => fn())
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
export function useLayoutSize<K extends keyof LayoutSizes>(key: K): LayoutSizes[K] {
  return useSyncExternalStore(subscribe, () => sizes[key])
}
