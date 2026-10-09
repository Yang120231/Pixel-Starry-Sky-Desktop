import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useEffect, useState } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { Button, IconButton, Segmented, cn } from '@/components/ui'
import { SettingRow } from '../SettingRow'
import { saveRequestRetry, useRequestRetry } from '../requestRetry'

export function RequestRetrySettings() {
  useI18n()
  const state = useRequestRetry()
  const [draft, setDraft] = useState('3')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (state.maxRetries !== null) setDraft(String(state.maxRetries))
  }, [state.maxRetries])
  const busy = state.loading || state.saving
  const parse = (): number | null => (/^\d+$/.test(draft) && Number(draft) <= 15 ? Number(draft) : null)
  const save = (value: number | null): void => {
    setError(null)
    if (value !== null) setDraft(String(value))
    void saveRequestRetry(value)
  }
  return (
    <SettingRow
      title={tr('settings.models.ModelsSection.message832')}
      description={tr('settings.models.RequestRetrySettings.message835')}
      hint={tr('settings.models.RequestRetrySettings.message836')}
    >
      <Segmented
        label={tr('settings.models.RequestRetrySettings.message837')}
        value={state.maxRetries === null ? 'engine' : 'custom'}
        options={[
          {
            value: 'engine',
            get label() {
              return tr('settings.models.RequestRetrySettings.message838')
            },
          },
          {
            value: 'custom',
            get label() {
              return tr('settings.account.TopUp.message673')
            },
          },
        ]}
        onChange={v => {
          if (!busy) save(v === 'engine' ? null : (parse() ?? 3))
        }}
      />
      {state.maxRetries !== null && (
        <form
          className="mt-3 space-y-3"
          onSubmit={e => {
            e.preventDefault()
            const value = parse()
            if (value === null) setError(tr('settings.models.RequestRetrySettings.message839'))
            else save(value)
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="request-retry-count" className="text-ui text-fg-secondary">
              {tr('settings.models.RequestRetrySettings.message840')}
            </label>
            <div className="flex items-center gap-1 rounded-md border border-line bg-surface p-1">
              <IconButton
                icon={Minus}
                label={tr('settings.models.RequestRetrySettings.message841')}
                size={28}
                iconSize={14}
                disabled={busy || (parse() ?? 0) <= 0}
                onClick={() => save(Math.max(0, (parse() ?? 3) - 1))}
              />
              <input
                id="request-retry-count"
                aria-label={tr('settings.models.RequestRetrySettings.message840')}
                type="number"
                inputMode="numeric"
                min="0"
                max="15"
                step="1"
                value={draft}
                disabled={busy}
                onChange={e => {
                  setDraft(e.target.value)
                  setError(null)
                }}
                className="h-7 w-16 rounded-sm bg-transparent px-1 text-center text-ui text-fg tabular-nums outline-none disabled:opacity-50"
              />
              <IconButton
                icon={Plus}
                label={tr('settings.models.RequestRetrySettings.message842')}
                size={28}
                iconSize={14}
                disabled={busy || (parse() ?? 15) >= 15}
                onClick={() => save(Math.min(15, (parse() ?? 3) + 1))}
              />
            </div>
            <Button type="submit" variant="outline" disabled={busy || draft === String(state.maxRetries)}>
              {state.saving ? tr('editor.FileEditor.message466') : tr('files.FileConfirm.message523')}
            </Button>
            <span className="text-meta text-fg-muted">{tr('settings.models.RequestRetrySettings.message843')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-meta text-fg-muted">{tr('settings.models.RequestRetrySettings.message844')}</span>
            {[0, 1, 3, 5, 10].map(value => (
              <button
                key={value}
                type="button"
                aria-label={tr('settings.models.RequestRetrySettings.message845', { p0: value })}
                disabled={busy}
                onClick={() => save(value)}
                className={cn(
                  'press h-7 min-w-8 rounded-full px-2.5 text-meta tabular-nums hover:bg-hover disabled:opacity-50',
                  state.maxRetries === value ? 'bg-selected text-fg' : 'bg-subtle text-fg-secondary',
                )}
              >
                {value}
              </button>
            ))}
          </div>
          <p className="text-meta text-fg-muted">
            {state.maxRetries === 0
              ? tr('settings.models.RequestRetrySettings.message846')
              : tr('settings.models.RequestRetrySettings.message847', {
                  p0: state.maxRetries,
                  p1: state.maxRetries + 1,
                })}
          </p>
        </form>
      )}
      {state.maxRetries === null && (
        <p className="mt-3 text-meta text-fg-muted">{tr('settings.models.RequestRetrySettings.message848')}</p>
      )}
      {(error || state.error) && (
        <p role="alert" className="mt-3 text-meta text-danger">
          {translateMessage(error ?? state.error ?? '')}
        </p>
      )}
      <Button
        variant="ghost"
        icon={RotateCcw}
        className="mt-2 -ml-3"
        disabled={busy || state.maxRetries === null}
        onClick={() => save(null)}
      >
        {tr('settings.models.RequestRetrySettings.message849')}
      </Button>
    </SettingRow>
  )
}
