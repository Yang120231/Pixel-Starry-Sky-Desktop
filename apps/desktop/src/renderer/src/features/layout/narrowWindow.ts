// 窗口窄于 1100px 时顶栏的 Git 和打开方式收进「⋮ 更多工具」（docs/ui/ui-polish-2026-10-13.md §6）
import { useSyncExternalStore } from 'react'

const QUERY = '(max-width: 1099px)'
const media = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null

function subscribe(listener: () => void): () => void {
  const list = media()
  list?.addEventListener('change', listener)
  return () => list?.removeEventListener('change', listener)
}

export function useNarrowWindow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? false,
    () => false,
  )
}
