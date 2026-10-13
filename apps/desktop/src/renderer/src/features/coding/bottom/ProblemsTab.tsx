import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'

/** 桩：还没接 tsc / eslint 输出（coding-mode.md §3.4） */
export function ProblemsTab() {
  useI18n()
  return (
    <div
      role="tabpanel"
      id="coding-bottom-page-problems"
      aria-labelledby="coding-bottom-tab-problems"
      className="flex min-w-0 flex-1 items-center justify-center text-meta text-fg-faint"
    >
      {tr('coding.bottom.problems.soon')}
    </div>
  )
}
