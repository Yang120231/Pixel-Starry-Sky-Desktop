import { X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { dismissWslHint, useWslHintDismissed } from '@/features/machines/wslHint'
import { useMachines } from '@/features/machines/store'

/** 当前机器是 WSL 发行版时，项目列表顶上的一句说明，可关（wsl-mode.plan.md §3.2） */
export function WslHint() {
  const { t } = useI18n()
  const state = useMachines()
  const current = state.machines.find(m => m.id === state.currentId)
  const dismissed = useWslHintDismissed(current?.id ?? '')
  if (current?.kind !== 'wsl' || dismissed) return null
  return (
    <div
      role="note"
      className="flex shrink-0 items-start gap-1 rounded-md bg-subtle py-2 pr-1 pl-2.5 text-meta text-fg-muted"
    >
      <p className="min-w-0 flex-1">{t('wsl.hint.text', { name: current.name })}</p>
      <button
        type="button"
        aria-label={t('wsl.hint.dismiss')}
        title={t('wsl.hint.dismiss')}
        onClick={() => dismissWslHint(current.id)}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-hover"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  )
}
