import { tr } from '../i18n/core'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useToast } from '@/components/ui'
import { finishItemNavigation, useItemNavigation } from './navigation'

/** 等会话 / 隐藏标签渲染完成后定位，仅执行一次。 */
export function useItemLocation(sessionId: string | null, scroller: RefObject<HTMLDivElement | null>, ready: boolean, onLocate?: () => void) {
  const target = useItemNavigation()
  const latestLocate = useRef(onLocate)
  latestLocate.current = onLocate
  const [highlight, setHighlight] = useState<string | null>(null)
  const toast = useToast()
  useEffect(() => {
    if (!target || target.sessionId !== sessionId || !ready) return
    let frame = 0, disposed = false
    const deadline = performance.now() + 2500
    const attempt = () => {
      const root = scroller.current
      if (disposed) return
      const el = root && Array.from(root.querySelectorAll<HTMLElement>('[data-search-item]')).find(e => e.dataset.searchItem === target.itemId)
      if (el && el.getBoundingClientRect().height > 0 && !el.closest('[inert],[aria-hidden="true"]')) {
        latestLocate.current?.()
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        setHighlight(target.itemId)
        finishItemNavigation(target.token)
        return
      }
      if (performance.now() < deadline) frame = requestAnimationFrame(attempt)
      else { finishItemNavigation(target.token); toast(tr("search.useItemLocation.message611")) }
    }
    frame = requestAnimationFrame(attempt)
    return () => { disposed = true; cancelAnimationFrame(frame) }
  }, [target, sessionId, ready, scroller, toast])
  useEffect(() => {
    if (!highlight) return
    const timer = window.setTimeout(() => setHighlight(null), 2000)
    return () => window.clearTimeout(timer)
  }, [highlight])
  return highlight
}
