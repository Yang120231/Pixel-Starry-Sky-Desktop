import { useI18n } from '@/i18n/I18nProvider'
import { cn } from './cn'

/** 快捷键提示：等宽小字、淡色、不加框（参考图「新建任务 ⌘K」的样式） */
export function Kbd({ children, className }: { children: string; className?: string }) {
  useI18n()
  return <kbd className={cn('shrink-0 font-mono text-label tracking-wide text-fg-faint', className)}>{children}</kbd>
}
