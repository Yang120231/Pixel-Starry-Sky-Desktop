import type { ReactNode } from 'react'
import { cn, Switch } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'

export function SectionTitle({ children }: { children: ReactNode }) {
  const { text } = useI18n()
  return (
    <h3 className="mb-4 text-section font-semibold text-fg">
      {typeof children === 'string' ? text(children) : children}
    </h3>
  )
}

/** 设置分组小标题（外观页里的「字体」「壁纸」），上方留出间距和分隔线 */
export function GroupTitle({ children }: { children: ReactNode }) {
  const { text } = useI18n()
  return (
    <h4
      data-setting-title={typeof children === 'string' ? children : undefined}
      className="mt-2 border-t border-line pt-6 pb-1 text-label font-medium text-fg-muted"
    >
      {typeof children === 'string' ? text(children) : children}
    </h4>
  )
}

/** 一行设置：标题、说明、控件、可选的提示 */
export function SettingRow({
  title,
  description,
  hint,
  hintTone = 'muted',
  control,
  children,
}: {
  title: string
  description: string
  hint?: string
  hintTone?: 'muted' | 'danger'
  control?: ReactNode
  children?: ReactNode
}) {
  const { text } = useI18n()
  const translatedTitle = text(title)
  return (
    <div
      data-setting-title={title}
      className="rounded-md border-t border-line-subtle py-5 first-of-type:border-t-0 first-of-type:pt-0"
    >
      <div className={control ? 'flex items-center justify-between gap-4' : undefined}>
        <div className="min-w-0">
          <div className="text-ui font-medium text-fg">{translatedTitle}</div>
          <p className="mt-1 mb-3 text-meta text-fg-muted">{text(description)}</p>
        </div>
        {control}
      </div>
      {children}
      {hint && (
        <p className={cn('mt-2 text-meta', hintTone === 'danger' ? 'text-danger' : 'text-fg-faint')}>{text(hint)}</p>
      )}
    </div>
  )
}

/** 设置页的开关（ui/Switch，md） */
export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return <Switch checked={checked} label={label} onChange={onChange} />
}
