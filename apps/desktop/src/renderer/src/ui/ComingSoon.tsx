import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Toast } from './Toast'

const ComingSoonContext = createContext<(label?: string) => void>(() => {})
export interface ToastOptions {
  /** 提示条上的按钮，例如「撤销」；点了就关掉提示 */
  action?: { label: string; run: () => void }
  /** 显示多久（毫秒）；带按钮时默认 5 秒，否则 1.6 秒 */
  duration?: number
}
type ToastFn = (message: string, options?: ToastOptions) => void
const ToastContext = createContext<ToastFn>(() => {})

/** Phase 1 还没有功能的按钮统一调用 useComingSoon()，弹出「即将推出」小提示 */
export function ComingSoonProvider({ children }: { children: ReactNode }) {
  useI18n()
  const [message, setMessage] = useState<string | null>(null),
    [action, setAction] = useState<ToastOptions['action']>(undefined),
    [seq, setSeq] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  const duration = useRef(1600)
  const arm = useCallback((ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(null), ms)
  }, [])

  const toast = useCallback<ToastFn>(
    (text, options) => {
      setMessage(text)
      setAction(options?.action)
      setSeq(n => n + 1)
      duration.current = options?.duration ?? (options?.action ? 5000 : 1600)
      arm(duration.current)
    },
    [arm],
  )
  const show = useCallback(
    (label?: string) =>
      toast(label ? tr('ui.ComingSoon.isComingSoon', { p0: label }) : tr('panel.RightPanel.comingSoon')),
    [toast],
  )

  return (
    <ComingSoonContext.Provider value={show}>
      <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
      {message && (
        <Toast
          key={`${seq}:${message}`}
          // 带按钮的要能点；鼠标停在上面时不消失，移开后再留一会儿
          className={action ? undefined : 'pointer-events-none'}
          onMouseEnter={action ? () => window.clearTimeout(timer.current) : undefined}
          onMouseLeave={action ? () => arm(Math.min(duration.current, 2000)) : undefined}
        >
          {message}
          {action && (
            <button
              type="button"
              onClick={() => {
                window.clearTimeout(timer.current)
                setMessage(null)
                action.run()
              }}
              className="shrink-0 rounded-sm px-1.5 py-0.5 font-medium text-accent-fg hover:bg-hover"
            >
              {action.label}
            </button>
          )}
        </Toast>
      )}
    </ComingSoonContext.Provider>
  )
}

export function useComingSoon(): (label?: string) => void {
  return useContext(ComingSoonContext)
}

/** 底部一句话的小提示（和「即将推出」同一个位置和样式），例如「这个会话已经删除」 */
export function useToast(): ToastFn {
  return useContext(ToastContext)
}
