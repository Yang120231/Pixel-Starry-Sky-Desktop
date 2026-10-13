import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Toast } from './Toast'

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
    (label?: string) =>
      toast(label ? tr('ui.ComingSoon.isComingSoon', { p0: label }) : tr('panel.RightPanel.comingSoon')),
    [toast],
  )

  return (
    <ComingSoonContext.Provider value={show}>
      <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
      {message && (
        <Toast key={message} className="pointer-events-none">
          {message}
        </Toast>
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
