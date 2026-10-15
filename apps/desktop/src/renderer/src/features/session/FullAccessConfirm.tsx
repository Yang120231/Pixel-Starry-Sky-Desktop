import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
// 切进完全放行前的就地确认：权限菜单和审批卡共用。每次都出现、不能关；
// 勾选框只管启用后输入框上方的提示条（所有对话、30 天），打开时按现有记录显示已勾 / 未勾。
import { useId, useState, type ReactNode } from 'react'
import { ShieldOff } from 'lucide-react'
import { cn } from '@/ui'
import { readFullAccessStripDismissed, setFullAccessStripDismissed } from './fullAccessStripState'

export function FullAccessConfirm({
  title,
  items,
  confirmLabel,
  cancelLabel,
  onCancel,
  onConfirm,
  disabled,
  className,
}: {
  title: string
  items: ReactNode[]
  confirmLabel: string
  cancelLabel: string
  onCancel: () => void
  onConfirm: () => void
  disabled?: boolean
  className?: string
}) {
  useI18n()
  const id = useId()
  const [hidden] = useState(readFullAccessStripDismissed)
  const [hideStrip, setHideStrip] = useState(hidden)
  return (
    <div role="alertdialog" aria-labelledby={id} data-full-access-confirm className={className}>
      <div id={id} className="flex items-center gap-2 text-ui font-medium text-fg">
        <ShieldOff size={15} strokeWidth={1.75} className="shrink-0 text-warn" />
        {title}
      </div>
      <ul className="mt-1.5 mb-2 list-disc space-y-0.5 pl-5 text-meta text-fg-secondary">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
      <label
        className={cn(
          'mb-2 flex cursor-pointer items-center gap-2 text-meta',
          hideStrip ? 'text-fg-secondary' : 'text-fg-muted',
        )}
      >
        <input
          type="checkbox"
          data-full-access-hide-strip
          checked={hideStrip}
          onChange={e => setHideStrip(e.target.checked)}
          className="size-3.5 shrink-0 accent-[var(--warn)]"
        />
        <span>
          {tr('fullAccess.confirm.hideStrip')}
          <span className="text-fg-faint"> · {tr('fullAccess.confirm.hideStripScope')}</span>
        </span>
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          autoFocus
          onClick={onCancel}
          className="press h-7 rounded-md border border-line px-2.5 text-meta text-fg-secondary hover:bg-hover hover:text-fg"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            // 没改勾选就不写，免得重新开始 30 天
            if (hideStrip !== hidden) setFullAccessStripDismissed(hideStrip)
            onConfirm()
          }}
          className="press h-7 rounded-md border border-warn/60 px-2.5 text-meta font-medium text-warn-fg hover:bg-warn/10 disabled:opacity-50"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}
