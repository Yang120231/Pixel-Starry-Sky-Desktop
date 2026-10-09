import { useI18n } from '@/i18n/I18nProvider'
import { cn } from './cn'

/** 改动统计：绿色 +N、红色 −N */
export function DiffStat({ added, removed, className }: { added: number; removed: number; className?: string }) {
  useI18n()
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 tabular-nums', className)}>
      <span className="text-success">+{added}</span>
      <span className="text-danger">−{removed}</span>
    </span>
  )
}
