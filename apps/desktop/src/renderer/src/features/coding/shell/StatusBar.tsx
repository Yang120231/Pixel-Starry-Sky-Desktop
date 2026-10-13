import { useI18n } from '@/i18n/I18nProvider'
import { StatusBarLeft, StatusBarRight } from '../status'

/** 窗口底部状态栏（高 24） */
export function StatusBar() {
  useI18n()
  return (
    <footer
      data-coding-status
      className="flex h-6 shrink-0 items-center border-t border-line-layout bg-sidebar px-2 text-label text-fg-muted"
    >
      <StatusBarLeft />
      <span className="flex-1" />
      <StatusBarRight />
    </footer>
  )
}
