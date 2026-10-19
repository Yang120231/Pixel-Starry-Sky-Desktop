import type { Ref } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { cn } from '@/ui'
import type { QuotaButtonStyle } from '@/features/settings/quotaDisplay'
import { QuotaMeter } from './QuotaMeter'
import type { QuotaButtonView, QuotaLevel } from './quotaModel'

const TONE: Record<QuotaLevel, string> = { normal: 'text-fg-muted', warn: 'text-warn', full: 'text-danger' }

/**
 * 按钮本体（只管显示，便于静态渲染测试和设置里的预览）：两根小进度条 + 最紧一项的简称和百分比。
 * 窄宽时 composerCompact.css 靠 data-quota-label 把文字藏起来，只剩图标。
 */
export function QuotaTrigger({
  view,
  style = 'full',
  open = false,
  preview = false,
  onClick,
  buttonRef,
}: {
  view: QuotaButtonView
  style?: QuotaButtonStyle
  open?: boolean
  /** 设置里的预览：不可点、不进 Tab 顺序 */
  preview?: boolean
  onClick?: () => void
  buttonRef?: Ref<HTMLButtonElement>
}) {
  useI18n()
  const text = style === 'full' && view.state === 'ok' && (view.short || view.value)
  return (
    <button
      ref={buttonRef}
      type="button"
      data-quota-trigger
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={view.label}
      aria-hidden={preview || undefined}
      tabIndex={preview ? -1 : undefined}
      title={view.title}
      onClick={onClick}
      className={cn(
        'press no-drag inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-meta hover:bg-hover',
        open && 'bg-hover',
        preview && 'pointer-events-none',
        TONE[view.level],
      )}
    >
      <QuotaMeter bars={view.bars} />
      {text && (
        <span data-quota-label className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
          {view.short && <span className={view.level === 'normal' ? 'text-fg-faint' : undefined}>{view.short}</span>}
          {view.value && <span>{view.value}</span>}
        </span>
      )}
    </button>
  )
}
