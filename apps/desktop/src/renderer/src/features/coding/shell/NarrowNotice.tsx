import { TriangleAlert } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'

/** 窗口窄到三栏放不下时显示在中栏上方 */
export function NarrowNotice() {
  useI18n()
  return (
    <div
      role="status"
      data-coding-narrow
      className="flex shrink-0 items-center gap-2 border-b border-line-layout bg-subtle px-3 py-1.5 text-meta text-fg-muted"
    >
      <TriangleAlert size={14} strokeWidth={1.5} className="shrink-0 text-warn" />
      <span className="min-w-0 truncate">{tr('coding.shell.tooNarrow')}</span>
    </div>
  )
}
