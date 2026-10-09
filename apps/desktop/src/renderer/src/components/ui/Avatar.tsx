import { useI18n } from '@/i18n/I18nProvider'
import { cn } from './cn'

/** 圆形头像：显示名字首字 */
export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  useI18n()
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-avatar font-medium text-avatar-fg',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
    >
      {name.slice(0, 1)}
    </span>
  )
}
