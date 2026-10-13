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

/**
 * 顶栏 / 侧栏顶部用的小号分段（「对话 | 代码」「本机 | 云端」，docs/ui/layout-v2.md §4、§5）：
 * 细边框轨道、总高 32px 和顶栏按钮一样；选中项只填底色（同 IconButton 的 active），不加粗、不加阴影，切换时字不跳。
 */
export const SEGMENT_TRACK =
  'no-drag inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-line p-[3px]'
export const segmentItem = (selected: boolean): string =>
  cn(
    'press no-drag inline-flex h-full shrink-0 items-center rounded-md',
    selected ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
  )
/** 放进轨道里的图标按钮（顶栏右边打开方式 + 右侧面板那一组）：28×24，填满轨道内高 */
export const SEGMENT_ICON = { width: 28, height: 24 } as const

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
              'press flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-ui',
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
