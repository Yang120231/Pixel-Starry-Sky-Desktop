import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { OPEN_SEARCH } from '@/shortcuts'
import { SearchDialog } from './SearchDialog'

const SearchContext = createContext<{ open: boolean; show(): void; toggle(): void } | null>(null)

/** 搜索弹窗每个窗口只有一个，分屏和标签切换共用。 */
export function SearchProvider({ children }: { children: ReactNode }) {
  useI18n()
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const openSearch = useCallback(() => {
    if (document.querySelector('[aria-modal="true"]:not([data-global-search]):not([data-command-palette])')) return
    window.dispatchEvent(new Event('pixelsky:close-command-for-search'))
    if (input.current) { input.current.focus(); input.current.select(); return }
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOpen(true)
  }, [])
  const close = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => { if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }) })
  }, [])
  useEffect(() => {
    const hide = (): void => setOpen(false)
    window.addEventListener('pixelsky:close-search-for-command', hide)
    const onKey = (e: KeyboardEvent) => {
      if (!OPEN_SEARCH.match(e) || e.isComposing) return
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-terminal-input]')) return
      e.preventDefault(); e.stopPropagation(); openSearch()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pixelsky:close-search-for-command', hide) }
  }, [openSearch])
  return <SearchContext.Provider value={{ open, show: openSearch, toggle: () => { if (open) close(); else openSearch() } }}>{children}{open && <SearchDialog inputRef={input} onClose={close} />}</SearchContext.Provider>
}

export function useOpenSearch(): () => void {
  const open = useContext(SearchContext)
  if (!open) throw new Error(tr("search.SearchProvider.message610"))
  return open.show
}
export function useSearchUi() { const value = useContext(SearchContext); if (!value) throw new Error(tr("search.SearchProvider.message610")); return value }
