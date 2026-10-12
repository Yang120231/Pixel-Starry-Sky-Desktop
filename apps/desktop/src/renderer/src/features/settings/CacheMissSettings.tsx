import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { Switch } from '@/ui'
import { SettingRow } from './SettingRow'
import { setCacheMissAlert, useCacheMissAlert } from './cacheMiss'

export function CacheMissSettings() {
  useI18n()
  const enabled = useCacheMissAlert()
  return (
    <SettingRow
      title={tr('settings.CacheMissSettings.cacheMissAlerts')}
      description={tr('settings.CacheMissSettings.getAlertWhenConsecutive')}
      hint={tr('settings.CacheMissSettings.noAlertsOnFirst')}
      control={
        <Switch
          checked={enabled}
          label={tr('settings.CacheMissSettings.cacheMissAlerts')}
          onChange={setCacheMissAlert}
        />
      }
    />
  )
}
