import { useI18n } from '@/i18n/I18nProvider'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** 面板内容区的白色卡片（预览区、占位页共用）：细边框 + 12px 圆角 + 极淡阴影 */
export function PanelCard({ children }: { children: ReactNode }) {
  useI18n()
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line-card bg-surface shadow-sm">
      {children}
    </div>
  )
}

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  hint?: string
}

/** 居中的空状态：44px 图标方块 + 标题 + 一行淡色说明 */
export function EmptyState({ icon: Icon, title, hint }: EmptyStateProps) {
  useI18n()
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl bg-subtle">
        <Icon size={20} strokeWidth={1.5} className="text-fg-muted" />
      </div>
      <p className="mt-3 text-ui font-medium text-fg-secondary">{title}</p>
      {hint && <p className="mt-1 text-meta text-fg-faint">{hint}</p>}
    </div>
  )
}
