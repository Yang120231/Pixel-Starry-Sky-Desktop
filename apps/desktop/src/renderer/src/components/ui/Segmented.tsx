import { useI18n } from '@/i18n/I18nProvider'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
}

interface SegmentedProps<T extends string> {
  /** 无障碍名称，例如「主题」 */
  label: string
  options: Array<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}

/** 分段按钮：轨道 bg-subtle，选中项是白色凸起块（docs/ui/settings.md §2） */
export function Segmented<T extends string>({ label, options, value, onChange, disabled = false }: SegmentedProps<T>) {
  useI18n()
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn('inline-flex rounded-lg bg-subtle p-0.5', disabled && 'opacity-45')}
    >
      {options.map(({ value: v, label: text, icon: Icon }) => {
        const selected = v === value
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(v)}
            className={cn(
              'press flex h-8 items-center gap-1.5 rounded-md border px-3 text-ui',
              selected
                ? 'border-line bg-surface font-medium text-fg shadow-sm'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {Icon && <Icon size={15} strokeWidth={1.5} className="shrink-0" />}
            {text}
          </button>
        )
      })}
    </div>
  )
}
