import { cn } from './cn'

/**
 * 开关（role=switch）。所有开关都用它，颜色在 globals.css 的 .ui-switch：开着是中性色（主按钮底色），
 * 只有 Ultracode 开着是紫色（docs/ui/design-tokens.md §1.5）。
 * size：设置页 md（40×24），输入框弹窗里 sm（34×20）
 */
export function Switch({
  checked,
  disabled,
  label,
  size = 'md',
  tone,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  size?: 'md' | 'sm'
  tone?: 'ultracode'
  onChange: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-tone={tone}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'ui-switch no-drag relative inline-flex shrink-0 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50',
        size === 'md' ? 'h-6 w-10 p-0.5' : 'h-5 w-[34px] px-0.5',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'ui-switch-knob inline-block rounded-full',
          size === 'md' ? 'size-5' : 'size-4',
          checked ? (size === 'md' ? 'translate-x-4' : 'translate-x-[14px]') : 'translate-x-0',
        )}
      />
    </button>
  )
}
