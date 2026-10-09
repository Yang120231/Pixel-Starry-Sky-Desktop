import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { cn } from './cn'

/** 运行中的小转圈（只是外观） */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  useI18n()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={cn('shrink-0 animate-spin text-fg-muted', className)}
      style={{ animationDuration: '1.4s' }}
      aria-label={tr('session.live.agentTrace.message193')}
    >
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
      <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}
