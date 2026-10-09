import { useState } from 'react'
import { normalizeSessionTitle, SESSION_TITLE_LIMIT } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { translateMessage } from '@/i18n/core'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

export function RenameSessionDialog({
  title,
  busy,
  error,
  onSave,
  onCancel,
}: {
  title: string
  busy: boolean
  error: string | null
  onSave: (title: string) => void
  onCancel: () => void
}) {
  const { t } = useI18n(),
    [value, setValue] = useState(title),
    [validation, setValidation] = useState<string | null>(null)
  const save = (): void => {
    if (busy) return
    try {
      const next = normalizeSessionTitle(value)
      setValidation(null)
      onSave(next)
    } catch (error) {
      setValidation(translateMessage((error as Error).message))
    }
  }
  return (
    <ConfirmDialog
      title={t('session.renameTitle')}
      focusInput
      description={
        <>
          <p>{t('session.renameDescription')}</p>
          <label className="mt-4 flex flex-col gap-2">
            <span>{t('session.name')}</span>
            <input
              data-session-title
              value={value}
              disabled={busy}
              aria-invalid={!!validation || !!error}
              onChange={event => {
                setValue(event.target.value)
                setValidation(null)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  save()
                }
              }}
              className="w-full min-w-0 rounded-md border border-line bg-surface px-3 py-2 text-ui text-fg outline-none focus:border-accent-line focus:ring-2 focus:ring-composer-ring"
            />
            <span className="text-right text-meta tabular-nums text-fg-muted">
              {Array.from(value).length} / {SESSION_TITLE_LIMIT}
            </span>
          </label>
        </>
      }
      busy={busy}
      error={validation ?? error}
      confirmLabel={t(busy ? 'session.busy' : 'session.save')}
      cancelLabel={t('session.cancel')}
      onConfirm={save}
      onCancel={onCancel}
    />
  )
}
