import { useI18n } from '@/i18n/I18nProvider'
import type { AriaAttributes, ReactNode } from 'react'
import { cn } from '@/ui'

/** 分组：28px 高的小标题（右侧可放一个 22px 图标按钮）+ 列表 */
export function SidebarSection({
  title,
  action,
  children,
  className,
  contentClassName,
}: {
  title: string
  /** 标题右侧的小按钮，建议 22px 图标按钮 */
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  useI18n()
  return (
    <section className={cn('flex shrink-0 flex-col', className)}>
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 pr-1.5 pl-2.5">
        <h3 className="min-w-0 truncate text-label font-medium text-fg-muted">{title}</h3>
        {action}
      </div>
      <div className={cn('flex flex-col gap-px', contentClassName)}>{children}</div>
    </section>
  )
}

/** 空状态提示行：一行淡色小字，30px 高 */
export function SidebarEmpty({ children, className }: { children: string; className?: string }) {
  useI18n()
  return (
    <div className={cn('flex h-[30px] shrink-0 items-center px-2.5 text-list text-fg-faint', className)}>
      {children}
    </div>
  )
}

/** 列表行：32px 高，悬停 bg-hover，选中 bg-selected */
export function SidebarRow({
  selected,
  onClick,
  className,
  children,
  title,
  ...aria
}: {
  selected?: boolean
  onClick?: () => void
  className?: string
  children: ReactNode
  title?: string
} & Pick<AriaAttributes, 'aria-expanded'>) {
  useI18n()
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      {...aria}
      className={cn(
        'flex h-8 w-full min-w-0 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left text-list transition-colors',
        selected ? 'bg-selected text-fg' : 'text-fg-secondary hover:bg-hover',
        className,
      )}
    >
      {children}
    </button>
  )
}
