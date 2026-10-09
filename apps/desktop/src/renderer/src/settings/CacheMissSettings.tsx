import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { cn } from '@/components/ui'
import { SettingRow } from './SettingRow'
import { setCacheMissAlert, useCacheMissAlert } from './cacheMiss'

export function CacheMissSettings() {
  useI18n()
  const enabled = useCacheMissAlert()
  return <SettingRow title={tr("settings.CacheMissSettings.message684")} description={tr("settings.CacheMissSettings.message685")}
    hint={tr("settings.CacheMissSettings.message686")}
    control={<button type="button" role="switch" aria-label={tr("settings.CacheMissSettings.message684")} aria-checked={enabled} onClick={() => setCacheMissAlert(!enabled)}
      className={cn('no-drag relative inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5', enabled ? 'bg-primary' : 'bg-subtle ring-1 ring-inset ring-line-strong')}>
      <span aria-hidden className={cn('size-5 rounded-full bg-surface shadow-sm', enabled ? 'translate-x-4' : 'translate-x-0')} />
    </button>} />
}
