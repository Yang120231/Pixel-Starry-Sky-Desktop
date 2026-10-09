import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

const ComingSoonContext = createContext<(label?: string) => void>(() => {})
const ToastContext = createContext<(message: string) => void>(() => {})

/** Phase 1 还没有功能的按钮统一调用 useComingSoon()，弹出「即将推出」小提示 */
export function ComingSoonProvider({ children }: { children: ReactNode }) {
  useI18n()
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const toast = useCallback((text: string) => {
    setMessage(text)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(null), 1600)
  }, [])
  const show = useCallback(
    (label?: string) => toast(label ? tr('ui.ComingSoon.message412', { p0: label }) : tr('panel.RightPanel.message87')),
    [toast],
  )

  return (
    <ComingSoonContext.Provider value={show}>
      <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
      {message && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-line bg-surface px-3.5 py-2 text-[13px] text-fg shadow-popover">
          {message}
        </div>
      )}
    </ComingSoonContext.Provider>
  )
}

export function useComingSoon(): (label?: string) => void {
  return useContext(ComingSoonContext)
}

/** 底部一句话的小提示（和「即将推出」同一个位置和样式），例如「这个会话已经删除」 */
export function useToast(): (message: string) => void {
  return useContext(ToastContext)
}
