import type { ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nProvider'

/** 左右两栏视图顶部那一行：标题 + 右侧按钮槽（高 36） */
export function PanelHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  useI18n()
  return (
    <div data-coding-panel-header className="flex h-9 shrink-0 items-center gap-1 px-3">
      <div className="min-w-0 flex-1 truncate text-label font-medium tracking-wide text-fg-muted uppercase">
        {title}
      </div>
      {actions ? <div className="no-drag flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </div>
  )
}
