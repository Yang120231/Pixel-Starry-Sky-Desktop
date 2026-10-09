import { useI18n } from '@/i18n/I18nProvider'
import { cn } from './cn'

/** 蓝色数字角标（图标栏的 3、5） */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  useI18n()
  return (
    <span
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-semibold text-accent-on',
        className,
      )}
    >
      {count}
    </span>
  )
}

type DotTone = 'accent' | 'notify' | 'success' | 'muted'
const DOT_COLORS: Record<DotTone, string> = {
  accent: 'bg-accent',
  notify: 'bg-notify',
  success: 'bg-success',
  muted: 'bg-fg-faint',
}

/** 小圆点：accent = 蓝色未读，notify = 红色提醒 */
export function Dot({ tone = 'accent', size = 7, className }: { tone?: DotTone; size?: number; className?: string }) {
  useI18n()
  return (
    <span
      className={cn('inline-block shrink-0 rounded-full', DOT_COLORS[tone], className)}
      style={{ width: size, height: size }}
    />
  )
}
